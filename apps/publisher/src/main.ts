/**
 * Publish the latest computed epoch onchain: `publish_epoch` (Merkle root + hashes), then
 * `upsert_score` for registered agents whose score moved materially.
 *
 * Unregistered (raw wallet) agents are committed in the root but not materialised by
 * default. Anyone can still verify them with `verify_score_proof`, and the oracle does not
 * pay rent for thousands of one-off payees.
 *
 * Security: this is the only process holding a signing key. Run it isolated with a
 * dedicated publisher key; `admin` (a multisig) can rotate it via `update_config`.
 */
import { createDb, createRepo } from "@ato/db";
import {
  fetchOracleConfig,
  getPublishEpochInstruction,
  getUpsertScoreInstruction,
  sendInstructions,
  TRUST_ORACLE_PROGRAM_ID,
} from "@ato/sdk";
import { loadKeypairSigner } from "@ato/sdk/node";
import { type Address, address, createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { z } from "zod";

const env = z
  .object({
    DATABASE_URL: z.string(),
    SOLANA_RPC_URL: z.string().url(),
    SOLANA_WS_URL: z.string().optional(),
    PUBLISHER_KEYPAIR_PATH: z.string(),
    PUBLISHER_DRY_RUN: z
      .string()
      .default("true")
      .transform((v) => v !== "false"),
    PUBLISHER_MIN_SCORE_DELTA: z.coerce.number().int().nonnegative().default(10),
    PUBLISHER_INCLUDE_UNREGISTERED: z
      .string()
      .default("false")
      .transform((v) => v === "true"),
    PUBLISHER_BATCH_SIZE: z.coerce.number().int().min(1).max(8).default(5),
    /** Agents with less raw inflow than this stay root-only (no rent spent on inactive agents). */
    PUBLISHER_MIN_RAW_VOLUME_MICROS: z.coerce.bigint().default(1n),
    ORACLE_PROGRAM_ID: z.string().optional(),
  })
  .parse(process.env);

const programId = (
  env.ORACLE_PROGRAM_ID ? address(env.ORACLE_PROGRAM_ID) : TRUST_ORACLE_PROGRAM_ID
) as Address;
const repo = createRepo(createDb(env.DATABASE_URL));
const rpc = createSolanaRpc(env.SOLANA_RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(
  env.SOLANA_WS_URL ?? env.SOLANA_RPC_URL.replace(/^http/, "ws"),
);
const signer = await loadKeypairSigner(env.PUBLISHER_KEYPAIR_PATH);

const epoch = await repo.latestEpoch("computed");
if (!epoch) {
  console.log("nothing to publish");
  process.exit(0);
}

const config = await fetchOracleConfig(rpc, programId);
if (!config) throw new Error(`oracle config not initialized for ${programId}`);
if (config.publisher !== signer.address)
  throw new Error(`signer ${signer.address} is not the publisher ${config.publisher}`);
if (config.paused) throw new Error("oracle is paused");
if (config.latestEpoch + 1n !== epoch.epoch) {
  throw new Error(
    `onchain latest_epoch=${config.latestEpoch}; cannot publish epoch ${epoch.epoch}`,
  );
}

const rows = (await repo.scoresForEpoch(epoch.epoch)).filter(
  (r) =>
    (env.PUBLISHER_INCLUDE_UNREGISTERED || r.registry !== "wallet") &&
    r.rawVolumeMicros >= env.PUBLISHER_MIN_RAW_VOLUME_MICROS,
);
const previous = await repo.lastPublished(rows.map((r) => r.agentId));
const changed = rows.filter((r) => {
  const p = previous.get(r.agentId);
  return (
    !p ||
    Math.abs(p.score - r.score) >= env.PUBLISHER_MIN_SCORE_DELTA ||
    p.flags !== r.flags ||
    Math.abs(p.confidence - r.confidence) >= 500
  );
});

const hex = (h: string) =>
  Uint8Array.from(h.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
const publishIx = await getPublishEpochInstruction({
  publisher: signer,
  programId,
  args: {
    epoch: epoch.epoch,
    merkleRoot: hex(epoch.merkleRoot),
    methodologyHash: hex(epoch.methodologyHash),
    inputsHash: hex(epoch.inputsHash),
    windowStart: BigInt(Math.floor(epoch.windowStart.getTime() / 1000)),
    windowEnd: BigInt(Math.floor(epoch.asOf.getTime() / 1000)),
    agentCount: epoch.agentCount,
    methodologyVersion: epoch.methodologyVersion,
  },
});

console.log(
  `epoch ${epoch.epoch}: ${changed.length}/${rows.length} scores to upsert${env.PUBLISHER_DRY_RUN ? " (dry run)" : ""}`,
);
if (env.PUBLISHER_DRY_RUN) {
  for (const r of changed.slice(0, 20))
    console.log(`  ${r.score.toString().padStart(4)} ${r.agentId}`);
  process.exit(0);
}

const submit = (ixs: Parameters<typeof sendInstructions>[2]) =>
  sendInstructions({ rpc, rpcSubscriptions }, signer, ixs);

await repo.setEpochStatus(epoch.epoch, "publishing");
try {
  const sig = await submit([publishIx]);
  console.log(`published epoch ${epoch.epoch}: ${sig}`);
  for (let i = 0; i < changed.length; i += env.PUBLISHER_BATCH_SIZE) {
    const batch = changed.slice(i, i + env.PUBLISHER_BATCH_SIZE);
    const ixs = await Promise.all(
      batch.map((r) =>
        getUpsertScoreInstruction({
          publisher: signer,
          programId,
          latestEpoch: epoch.epoch,
          args: {
            agent: address(r.agentId),
            registry: { "8004": 0, sati: 1, wallet: 2 }[r.registry],
            score: r.score,
            confidence: r.confidence,
            flags: r.flags,
            washRatioBps: r.washRatioBps,
            uniquePayers: r.uniquePayers,
            organicVolume: r.organicVolumeMicros,
            rawVolume: r.rawVolumeMicros,
          },
        }),
      ),
    );
    const s = await submit(ixs);
    await repo.markScoresPublished(
      epoch.epoch,
      batch.map((r) => r.agentId),
      s,
    );
    console.log(`  upserted ${i + batch.length}/${changed.length}`);
  }
  await repo.setEpochStatus(epoch.epoch, "published", sig);
} catch (e) {
  await repo.setEpochStatus(epoch.epoch, "failed");
  throw e;
}
process.exit(0);
