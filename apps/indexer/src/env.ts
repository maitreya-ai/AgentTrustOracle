import { z } from "zod";

const list = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

const schema = z.object({
  DATABASE_URL: z.string(),
  SOLANA_CLUSTER: z.enum(["mainnet-beta", "devnet", "localnet"]).default("devnet"),
  SOLANA_RPC_URL: z.string().url(),
  INDEXER_EXTRA_ADDRESSES: list,
  /** Facilitator fee payers sign every x402 tx they sponsor: very high volume on mainnet. */
  INDEXER_WATCH_FACILITATORS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  INDEXER_WATCH_CHANNELS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  INDEXER_WATCH_AGENT_WALLETS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  INDEXER_CONCURRENCY: z.coerce.number().int().positive().default(8),
  /** Client-side request pacing; 0 = unlimited. ~3.5 suits public devnet/mainnet RPC. */
  INDEXER_RPC_MAX_RPS: z.coerce.number().nonnegative().default(0),
  INDEXER_BACKFILL_PAGES: z.coerce.number().int().positive().default(10),
  LASERSTREAM_ENDPOINT: z.string().optional(),
  LASERSTREAM_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
export const loadEnv = (): Env => schema.parse(process.env);
