import { limiter, resolveFirstFunder } from "@ato/solana";
import type { IndexerContext } from "./context";

/** Resolve first-funder and wallet age for queued wallets (feeds sybil clustering). */
export async function resolveFunding(ctx: IndexerContext, batchSize = 50) {
  const pending = await ctx.repo.pendingProfiles(batchSize);
  const run = limiter(Math.min(4, ctx.env.INDEXER_CONCURRENCY));
  await Promise.all(
    pending.map(({ address }) =>
      run(async () => {
        try {
          await ctx.repo.saveProfile(address, await resolveFirstFunder(ctx.rpc, address));
        } catch (e) {
          await ctx.repo.saveProfile(address, {
            status: "pending",
            error: String(e).slice(0, 200),
          });
        }
      }),
    ),
  );
  return pending.length;
}
