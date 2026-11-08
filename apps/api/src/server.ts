import { createDb } from "@ato/db";
import { createApp } from "./app";
import { loadEnv } from "./env";
import { dbStore } from "./store";

const env = loadEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!env.X402_PAY_TO) console.warn("X402_PAY_TO not set: paid routes are FREE (dev mode)");

const app = createApp({
  store: dbStore(createDb(env.DATABASE_URL)),
  ...(env.X402_PAY_TO
    ? {
        paywall: {
          payTo: env.X402_PAY_TO,
          network: env.X402_NETWORK,
          facilitatorUrl: env.X402_FACILITATOR_URL,
          prices: {
            score: env.X402_PRICE_SCORE,
            report: env.X402_PRICE_REPORT,
            batch: env.X402_PRICE_BATCH,
          },
        },
      }
    : {}),
});

export default { port: env.PORT, fetch: app.fetch };
console.log(`trust oracle API on :${env.PORT}`);
