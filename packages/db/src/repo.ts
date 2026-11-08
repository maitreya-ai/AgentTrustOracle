import type {
  AgentIdentity,
  EpochInput,
  EpochResult,
  Payment,
  WalletLink,
  WalletProfile,
} from "@ato/core";
import { and, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  agents,
  epochs,
  ingestCursors,
  payments,
  scores,
  walletLinks,
  walletProfiles,
} from "./schema";

/** jsonb cannot hold bigint: store them as decimal strings. */
export const toJson = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

const CHUNK = 1_000;
function* chunks<T>(xs: readonly T[], n = CHUNK): Generator<T[]> {
  for (let i = 0; i < xs.length; i += n) yield xs.slice(i, i + n);
}

export function createRepo(db: Db) {
  return {
    db,

    // ── Ingestion ─────────────────────────────────────────────────────────────────────
    async insertPayments(rows: readonly (Payment & { memo?: string })[]) {
      for (const batch of chunks(rows)) {
        await db
          .insert(payments)
          .values(
            batch.map((p) => ({
              id: p.id,
              signature: p.signature,
              slot: p.slot,
              blockTime: new Date(p.blockTime * 1000),
              rail: p.rail,
              payer: p.payer,
              payee: p.payee,
              mint: p.mint,
              amount: p.amount,
              usdMicros: p.usdMicros,
              feePayer: p.feePayer ?? null,
              facilitator: p.facilitator ?? null,
              memo: p.memo ?? null,
            })),
          )
          .onConflictDoNothing();
      }
    },

    async insertLinks(rows: readonly WalletLink[]) {
      for (const batch of chunks(rows)) {
        await db
          .insert(walletLinks)
          .values(
            batch.map((l) => ({
              from: l.from,
              to: l.to,
              kind: l.kind,
              evidence: l.evidence ?? null,
            })),
          )
          .onConflictDoNothing();
      }
    },

    /** Queue wallets for funding resolution (no-op for known ones). */
    async ensureProfiles(addresses: readonly string[]) {
      const unique = [...new Set(addresses)];
      for (const batch of chunks(unique)) {
        await db
          .insert(walletProfiles)
          .values(batch.map((address) => ({ address })))
          .onConflictDoNothing();
      }
    },

    async pendingProfiles(limit: number, maxAttempts = 5) {
      return db
        .select({ address: walletProfiles.address })
        .from(walletProfiles)
        .where(and(eq(walletProfiles.status, "pending"), lte(walletProfiles.attempts, maxAttempts)))
        .limit(limit);
    },

    async saveProfile(
      address: string,
      p:
        | { status: "resolved"; firstSeenAt: number; firstFunder?: string; signature: string }
        | { status: "unresolvable"; reason: string; oldestSeenAt?: number }
        | { status: "pending"; error: string },
    ) {
      await db
        .update(walletProfiles)
        .set({
          status: p.status,
          firstSeenAt:
            p.status === "resolved"
              ? new Date(p.firstSeenAt * 1000)
              : p.status === "unresolvable" && p.oldestSeenAt
                ? new Date(p.oldestSeenAt * 1000)
                : null,
          firstFunder: p.status === "resolved" ? (p.firstFunder ?? null) : null,
          fundingSignature: p.status === "resolved" ? p.signature : null,
          note: p.status === "unresolvable" ? p.reason : p.status === "pending" ? p.error : null,
          attempts: sql`${walletProfiles.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(walletProfiles.address, address));
    },

    async getCursor(stream: string) {
      const [row] = await db.select().from(ingestCursors).where(eq(ingestCursors.stream, stream));
      return row ?? null;
    },

    async setCursor(stream: string, lastSignature: string, lastSlot: number) {
      await db
        .insert(ingestCursors)
        .values({ stream, lastSignature, lastSlot })
        .onConflictDoUpdate({
          target: ingestCursors.stream,
          set: { lastSignature, lastSlot, updatedAt: new Date() },
        });
    },

    async upsertAgents(rows: readonly (AgentIdentity & { agentUri?: string })[]) {
      for (const batch of chunks(rows)) {
        await db
          .insert(agents)
          .values(
            batch.map((a) => ({
              id: a.id,
              registry: a.registry,
              wallets: a.wallets,
              owner: a.owner ?? null,
              creator: a.creator ?? null,
              parent: a.parent ?? null,
              agentUri: a.agentUri ?? null,
            })),
          )
          .onConflictDoUpdate({
            target: agents.id,
            set: {
              wallets: sql`excluded.wallets`,
              owner: sql`excluded.owner`,
              creator: sql`excluded.creator`,
              parent: sql`excluded.parent`,
              agentUri: sql`excluded.agent_uri`,
              syncedAt: new Date(),
            },
          });
      }
    },

    async agentWallets(): Promise<Set<string>> {
      const rows = await db
        .select({ wallets: agents.wallets })
        .from(agents)
        .where(sql`${agents.registry} <> 'wallet'`);
      return new Set(rows.flatMap((r) => r.wallets));
    },

    // ── Scoring ───────────────────────────────────────────────────────────────────────
    async loadEpochInput(epoch: bigint, asOf: number, windowDays: number): Promise<EpochInput> {
      const from = new Date((asOf - windowDays * 86_400) * 1000);
      const to = new Date(asOf * 1000);
      const paymentRows = await db
        .select()
        .from(payments)
        .where(and(gt(payments.blockTime, from), lte(payments.blockTime, to)));
      const linkRows = await db.select().from(walletLinks);
      const profileRows = await db
        .select()
        .from(walletProfiles)
        .where(isNotNull(walletProfiles.firstSeenAt));
      const agentRows = await db.select().from(agents).where(sql`${agents.registry} <> 'wallet'`);

      const wallets: WalletProfile[] = profileRows.map((p) => ({
        address: p.address,
        ...(p.firstSeenAt ? { firstSeenAt: Math.floor(p.firstSeenAt.getTime() / 1000) } : {}),
        ...(p.firstFunder ? { firstFunder: p.firstFunder } : {}),
      }));

      return {
        epoch,
        asOf,
        payments: paymentRows.map((p) => ({
          id: p.id,
          signature: p.signature,
          slot: p.slot,
          blockTime: Math.floor(p.blockTime.getTime() / 1000),
          rail: p.rail,
          payer: p.payer,
          payee: p.payee,
          mint: p.mint,
          amount: p.amount,
          usdMicros: p.usdMicros,
          ...(p.feePayer ? { feePayer: p.feePayer } : {}),
          ...(p.facilitator ? { facilitator: p.facilitator } : {}),
        })),
        links: linkRows.map((l) => ({
          from: l.from,
          to: l.to,
          kind: l.kind,
          ...(l.evidence ? { evidence: l.evidence } : {}),
        })),
        wallets,
        agents: agentRows.map((a) => ({
          id: a.id,
          registry: a.registry,
          wallets: a.wallets,
          ...(a.owner ? { owner: a.owner } : {}),
          ...(a.creator ? { creator: a.creator } : {}),
          ...(a.parent ? { parent: a.parent } : {}),
        })),
      };
    },

    async latestEpoch(status?: "computed" | "published") {
      const q = db.select().from(epochs);
      const [row] = await (status ? q.where(eq(epochs.status, status)) : q)
        .orderBy(desc(epochs.epoch))
        .limit(1);
      return row ?? null;
    },

    async saveEpoch(result: EpochResult) {
      await db.transaction(async (tx) => {
        await tx.insert(epochs).values({
          epoch: result.epoch,
          asOf: new Date(result.asOf * 1000),
          windowStart: new Date(result.windowStart * 1000),
          methodologyVersion: result.methodologyVersion,
          methodologyHash: result.methodologyHash,
          inputsHash: result.inputsHash,
          merkleRoot: result.merkleRoot,
          agentCount: result.scores.length,
          stats: toJson(result.stats),
          diagnostics: toJson(result.diagnostics),
        });
        for (const batch of chunks(result.scores, 500)) {
          await tx.insert(scores).values(
            batch.map((s) => ({
              epoch: result.epoch,
              agentId: s.agent,
              registry: s.registry,
              entity: s.entity,
              score: s.score,
              confidence: s.confidence,
              flags: s.flags,
              washRatioBps: s.washRatioBps,
              uniquePayers: s.uniquePayers,
              organicVolumeMicros: s.organicVolumeMicros,
              rawVolumeMicros: s.rawVolumeMicros,
              components: toJson(s.components),
              features: toJson(s.features),
              evidence: toJson(s.evidence),
              proof: result.proofs.get(s.agent) ?? [],
            })),
          );
        }
      });
    },

    /** Drop an epoch that was computed but never published, so it can be recomputed. */
    async deleteUnpublishedEpoch(epoch: bigint) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ status: epochs.status })
          .from(epochs)
          .where(eq(epochs.epoch, epoch));
        if (!row) return;
        if (row.status !== "computed" && row.status !== "failed") {
          throw new Error(`epoch ${epoch} is ${row.status}; refusing to delete`);
        }
        await tx.delete(scores).where(eq(scores.epoch, epoch));
        await tx.delete(epochs).where(eq(epochs.epoch, epoch));
      });
    },

    async scoresForEpoch(epoch: bigint) {
      return db.select().from(scores).where(eq(scores.epoch, epoch));
    },

    /** Most recent onchain-published row per agent (what the chain currently holds). */
    async lastPublished(agentIds: readonly string[]) {
      if (agentIds.length === 0) return new Map<string, typeof scores.$inferSelect>();
      const rows = await db
        .selectDistinctOn([scores.agentId])
        .from(scores)
        .where(and(inArray(scores.agentId, [...agentIds]), isNotNull(scores.publishSignature)))
        .orderBy(scores.agentId, desc(scores.epoch));
      return new Map(rows.map((r) => [r.agentId, r]));
    },

    async markScoresPublished(epoch: bigint, agentIds: readonly string[], signature: string) {
      if (agentIds.length === 0) return;
      await db
        .update(scores)
        .set({ publishSignature: signature })
        .where(and(eq(scores.epoch, epoch), inArray(scores.agentId, [...agentIds])));
    },

    async setEpochStatus(
      epoch: bigint,
      status: "publishing" | "published" | "failed",
      signature?: string,
    ) {
      await db
        .update(epochs)
        .set({
          status,
          ...(signature ? { publishSignature: signature } : {}),
          ...(status === "published" ? { publishedAt: new Date() } : {}),
        })
        .where(eq(epochs.epoch, epoch));
    },

    // ── API reads ─────────────────────────────────────────────────────────────────────
    async latestScore(agentId: string) {
      const [row] = await db
        .select()
        .from(scores)
        .where(eq(scores.agentId, agentId))
        .orderBy(desc(scores.epoch))
        .limit(1);
      return row ?? null;
    },

    async agentForWallet(wallet: string) {
      const [row] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(sql`${wallet} = ANY(${agents.wallets})`)
        .limit(1);
      return row?.id ?? null;
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
