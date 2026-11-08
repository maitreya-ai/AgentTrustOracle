import type { EpochResult } from "@ato/core";
import { createRepo, type Db, toJson } from "@ato/db";

export interface StoredScore {
  epoch: bigint;
  agentId: string;
  registry: "8004" | "sati" | "wallet";
  score: number;
  confidence: number;
  flags: number;
  washRatioBps: number;
  uniquePayers: number;
  organicVolumeMicros: bigint;
  rawVolumeMicros: bigint;
  components: unknown;
  features: unknown;
  evidence: unknown;
  proof: string[];
}

export interface EpochSummary {
  epoch: bigint;
  status: string;
  asOf: Date;
  merkleRoot: string;
  methodologyVersion: number;
  methodologyHash: string;
  inputsHash: string;
  agentCount: number;
  stats: unknown;
}

/** Read side of the API. DB-backed in production, in-memory for tests and demos. */
export interface ScoreStore {
  latestEpoch(): Promise<EpochSummary | null>;
  latestScore(agentId: string): Promise<StoredScore | null>;
  agentForWallet(wallet: string): Promise<string | null>;
}

export function dbStore(db: Db): ScoreStore {
  const repo = createRepo(db);
  return {
    latestEpoch: () => repo.latestEpoch(),
    latestScore: (id) => repo.latestScore(id),
    agentForWallet: (w) => repo.agentForWallet(w),
  };
}

export function memoryStore(
  result: EpochResult,
  agentWallets: Record<string, string> = {},
): ScoreStore {
  const byAgent = new Map<string, StoredScore>(
    result.scores.map((s) => [
      s.agent,
      {
        epoch: result.epoch,
        agentId: s.agent,
        registry: s.registry,
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
      },
    ]),
  );
  const summary: EpochSummary = {
    epoch: result.epoch,
    status: "computed",
    asOf: new Date(result.asOf * 1000),
    merkleRoot: result.merkleRoot,
    methodologyVersion: result.methodologyVersion,
    methodologyHash: result.methodologyHash,
    inputsHash: result.inputsHash,
    agentCount: result.scores.length,
    stats: toJson(result.stats),
  };
  return {
    latestEpoch: async () => summary,
    latestScore: async (id) => byAgent.get(id) ?? null,
    agentForWallet: async (w) => agentWallets[w] ?? (byAgent.has(w) ? w : null),
  };
}
