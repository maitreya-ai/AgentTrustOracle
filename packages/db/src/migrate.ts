import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { createDb } from "./client";

const db = createDb();
await migrate(db, { migrationsFolder: join(import.meta.dir, "..", "migrations") });
console.log("migrations applied");
process.exit(0);
