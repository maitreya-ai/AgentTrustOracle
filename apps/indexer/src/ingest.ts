import type { WalletLink } from "@ato/core";
import type { ClassifiedPayment } from "@ato/solana";
import {
  classifyTransaction,
  fetchNormalizedTransaction,
  limiter,
  type NormalizedTx,
  signaturePages,
} from "@ato/solana";
import type { IndexerContext } from "./context";

/** Classify and persist a batch of normalized transactions. */
export async function persist(ctx: IndexerContext, txs: readonly NormalizedTx[]) {
  const payments: ClassifiedPayment[] = [];
  const links: WalletLink[] = [];
  for (const tx of txs) {
    const r = classifyTransaction(tx, ctx.classify);
    payments.push(...r.payments);
    links.push(...r.links);
    for (const note of r.notes) console.warn(`[classify] ${note}`);
  }
  await ctx.repo.insertPayments(payments);
  await ctx.repo.insertLinks(links);
  await ctx.repo.ensureProfiles(payments.flatMap((p) => [p.payer, p.payee]));
  return { payments: payments.length, links: links.length };
}

/**
 * Ingest an address's history newer than its cursor, oldest first, then advance the cursor.
 * Used for both backfill (many pages) and polling (few pages).
 */
export async function syncAddress(ctx: IndexerContext, address: string, maxPages: number) {
  const cursor = await ctx.repo.getCursor(address);
  const sigs: { signature: string; slot: number; failed: boolean }[] = [];
  for await (const page of signaturePages(ctx.rpc, address, {
    maxPages,
    ...(cursor?.lastSignature ? { until: cursor.lastSignature } : {}),
  })) {
    sigs.push(...page);
  }
  if (sigs.length === 0) return { address, transactions: 0, payments: 0 };

  const run = limiter(ctx.env.INDEXER_CONCURRENCY);
  const live = sigs.filter((s) => !s.failed).reverse(); // oldest first
  let payments = 0;
  for (let i = 0; i < live.length; i += 100) {
    const batch = live.slice(i, i + 100);
    const txs = await Promise.all(
      batch.map((s) => run(() => fetchNormalizedTransaction(ctx.rpc, s.signature))),
    );
    payments += (
      await persist(
        ctx,
        txs.filter((t): t is NormalizedTx => t !== null),
      )
    ).payments;
  }
  const newest = sigs[0];
  if (newest) await ctx.repo.setCursor(address, newest.signature, newest.slot);
  return { address, transactions: sigs.length, payments };
}
