import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().default(8787),
  DATABASE_URL: z.string().optional(),
  X402_PAY_TO: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  X402_FACILITATOR_URL: z.string().url().default("https://facilitator.payai.network"),
  X402_NETWORK: z.string().default("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
  X402_PRICE_SCORE: z.string().default("$0.001"),
  X402_PRICE_REPORT: z.string().default("$0.01"),
  X402_PRICE_BATCH: z.string().default("$0.02"),
});

export type Env = z.infer<typeof schema>;
export const loadEnv = (source: Record<string, string | undefined> = process.env): Env =>
  schema.parse(source);
