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
  INDEXER_WATCH_AGENT_WALLETS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  INDEXER_CONCURRENCY: z.coerce.number().int().positive().default(8),
  INDEXER_BACKFILL_PAGES: z.coerce.number().int().positive().default(10),
  LASERSTREAM_ENDPOINT: z.string().optional(),
  LASERSTREAM_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
export const loadEnv = (): Env => schema.parse(process.env);
