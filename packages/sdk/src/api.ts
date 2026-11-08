import type { Tier } from "./policy";

/** Response shapes of the score API (apps/api). */
export interface BadgeResponse {
  agent: string;
  tier: Tier;
  epoch: string | null;
}

export interface ScoreResponse {
  agent: string;
  registry: string;
  epoch: string;
  score: number;
  confidence: number;
  flags: number;
  flagNames: string[];
  washRatioBps: number;
  uniquePayers: number;
  organicVolumeUsd: number;
  rawVolumeUsd: number;
  tier: Tier;
  methodologyVersion: number;
}

export interface ReportResponse extends ScoreResponse {
  components: Record<string, number>;
  features: Record<string, number | string>;
  evidence: {
    linkedWallets: string[];
    mergeLinks: { from: string; to: string; kind: string; evidence?: string }[];
    cycles: { path: string[]; amountUsd: number; intensity: number; wash: boolean }[];
  };
}

export interface ProofResponse {
  agent: string;
  epoch: string;
  merkleRoot: string;
  leaf: {
    agent: string;
    registry: number;
    epoch: string;
    score: number;
    confidence: number;
    flags: number;
    washRatioBps: number;
    uniquePayers: number;
    organicVolume: string;
  };
  proof: string[];
}

export interface TrustOracleClientOptions {
  baseUrl: string;
  /**
   * Fetch used for paid endpoints. Pass an x402-wrapped fetch (see `@ato/sdk/x402`) so
   * HTTP 402 challenges are paid automatically. Free endpoints use plain fetch.
   */
  paidFetch?: typeof fetch;
  fetch?: typeof fetch;
}

export class TrustOracleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createTrustOracleClient(opts: TrustOracleClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const free = opts.fetch ?? fetch;
  const paid = opts.paidFetch ?? free;

  async function get<T>(f: typeof fetch, path: string, init?: RequestInit): Promise<T> {
    const res = await f(`${base}${path}`, init);
    if (!res.ok) {
      throw new TrustOracleError(
        res.status,
        `${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  return {
    /** Free: coarse tier only. */
    badge: (agent: string) => get<BadgeResponse>(free, `/v1/agents/${agent}/badge`),
    /** Free: Merkle proof for onchain verification (`verify_score_proof`). */
    proof: (agent: string) => get<ProofResponse>(free, `/v1/agents/${agent}/proof`),
    /** Paid (x402): full score with flags and volumes. */
    score: (agent: string) => get<ScoreResponse>(paid, `/v1/agents/${agent}/score`),
    /** Paid (x402): score plus components, features and evidence. */
    report: (agent: string) => get<ReportResponse>(paid, `/v1/agents/${agent}/report`),
    /** Paid (x402): resolve a payment wallet to its agent and score. */
    wallet: (address: string) => get<ScoreResponse>(paid, `/v1/wallets/${address}/score`),
    /** Paid (x402): up to 50 agents in one call. */
    batch: (agents: string[]) =>
      get<{ scores: ScoreResponse[]; missing: string[] }>(paid, "/v1/scores/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agents }),
      }),
  };
}

export type TrustOracleClient = ReturnType<typeof createTrustOracleClient>;
