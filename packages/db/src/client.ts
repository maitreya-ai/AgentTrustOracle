import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

/** Drizzle over Bun's native Postgres client (`Bun.SQL`): no extra driver dependency. */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(url, { schema });
}

export type Db = ReturnType<typeof createDb>;
