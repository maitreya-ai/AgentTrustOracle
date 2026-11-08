import { createDb, createRepo, type Repo } from "@ato/db";
import { type ClassifyContext, type IndexerRpc, KNOWN_FACILITATORS, PROGRAMS } from "@ato/solana";
import { createSolanaRpc } from "@solana/kit";
import type { Env } from "./env";

export interface IndexerContext {
  env: Env;
  rpc: IndexerRpc;
  repo: Repo;
  classify: ClassifyContext;
  /** Addresses whose full transaction history we ingest. */
  watched: string[];
}

/** Facilitator fee payers and channel operators sponsor unrelated users: never link evidence. */
export const INFRASTRUCTURE = new Set<string>([
  ...Object.keys(KNOWN_FACILITATORS),
  PROGRAMS.paymentChannels,
]);

export async function createContext(env: Env): Promise<IndexerContext> {
  const repo = createRepo(createDb(env.DATABASE_URL));
  const agentWallets = await repo.agentWallets();
  const watched = [
    PROGRAMS.paymentChannels,
    ...(env.SOLANA_CLUSTER === "mainnet-beta" ? Object.keys(KNOWN_FACILITATORS) : []),
    ...env.INDEXER_EXTRA_ADDRESSES,
    ...(env.INDEXER_WATCH_AGENT_WALLETS ? agentWallets : []),
  ];
  return {
    env,
    rpc: createSolanaRpc(env.SOLANA_RPC_URL),
    repo,
    classify: {
      cluster: env.SOLANA_CLUSTER,
      trackedWallets: agentWallets,
      infrastructure: INFRASTRUCTURE,
    },
    watched: [...new Set(watched)],
  };
}
