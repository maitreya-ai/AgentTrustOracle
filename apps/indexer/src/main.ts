/**
 * Indexer entry point.
 *
 *   bun src/main.ts registry   # sync agent identities from the 8004 registry
 *   bun src/main.ts backfill   # ingest history of watched addresses (INDEXER_BACKFILL_PAGES)
 *   bun src/main.ts poll       # tail watched addresses over RPC
 *   bun src/main.ts stream     # tail over LaserStream gRPC (needs LASERSTREAM_*)
 *   bun src/main.ts funding    # resolve funding origin for queued wallets, then exit
 *
 * For deep mainnet history, public RPC is not enough (facilitators sign millions of txs).
 * Use an archival provider, or backfill from Substreams (see docs/architecture.md).
 */
import { createContext } from "./context";
import { loadEnv } from "./env";
import { resolveFunding } from "./funding";
import { syncAddress } from "./ingest";
import { syncRegistries } from "./registry";
import { stream } from "./stream";

const command = process.argv[2] ?? "poll";
const ctx = await createContext(loadEnv());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

switch (command) {
  case "registry":
    await syncRegistries(ctx);
    process.exit(0);
    break;
  case "backfill":
    for (const address of ctx.watched) {
      console.log("[backfill]", await syncAddress(ctx, address, ctx.env.INDEXER_BACKFILL_PAGES));
    }
    process.exit(0);
    break;
  case "funding": {
    for (let n = await resolveFunding(ctx); n > 0; n = await resolveFunding(ctx)) {
      console.log(`[funding] resolved ${n}`);
    }
    process.exit(0);
    break;
  }
  case "poll":
    console.log(
      `[poll] watching ${ctx.watched.length} addresses every ${ctx.env.INDEXER_POLL_INTERVAL_MS}ms`,
    );
    while (true) {
      for (const address of ctx.watched) {
        try {
          const r = await syncAddress(ctx, address, 2);
          if (r.payments > 0) console.log("[poll]", r);
        } catch (e) {
          console.error(`[poll] ${address}`, e);
        }
      }
      await resolveFunding(ctx, 20).catch((e) => console.error("[funding]", e));
      await sleep(ctx.env.INDEXER_POLL_INTERVAL_MS);
    }
  case "stream":
    await stream(ctx);
    break;
  default:
    console.error(`unknown command: ${command}`);
    process.exit(1);
}
