import { createDb, createRepo, type Repo } from "@ato/db";
import {
  type ClassifyContext,
  createResilientRpc,
  type IndexerRpc,
  KNOWN_FACILITATORS,
  PROGRAMS,
  paymentAddresses,
} from "@ato/solana";
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
  // Wallets are expanded to their stablecoin ATAs: inbound transfers only reference those.
  const wallets = [
    ...env.INDEXER_EXTRA_ADDRESSES,
    ...(env.INDEXER_WATCH_AGENT_WALLETS ? agentWallets : []),
  ];
  const expanded = (
    await Promise.all(wallets.map((w) => paymentAddresses(env.SOLANA_CLUSTER, w)))
  ).flat();
  const watched = [
    ...(env.INDEXER_WATCH_CHANNELS ? [PROGRAMS.paymentChannels] : []),
    ...(env.INDEXER_WATCH_FACILITATORS ? Object.keys(KNOWN_FACILITATORS) : []),
    ...expanded,
  ];
  // Extra addresses are tracked for direct-transfer classification as well.
  for (const w of env.INDEXER_EXTRA_ADDRESSES) agentWallets.add(w);
  return {
    env,
    rpc: createResilientRpc(env.SOLANA_RPC_URL, { maxRps: env.INDEXER_RPC_MAX_RPS }),
    repo,
    classify: {
      cluster: env.SOLANA_CLUSTER,
      trackedWallets: agentWallets,
      infrastructure: INFRASTRUCTURE,
    },
    watched: [...new Set(watched)],
  };
}
