import type { Address } from "@ato/core";
import { decodeSystemTransfer } from "./decode";
import { allInstructions, type NormalizedTx } from "./normalize";
import { fetchNormalizedTransaction, type IndexerRpc, signaturePages } from "./rpc";

export type FundingResolution =
  | { status: "resolved"; firstSeenAt: number; firstFunder?: Address; signature: string }
  | { status: "unresolvable"; reason: string; oldestSeenAt?: number };

/** The first lamports a wallet received in `tx`, if any. */
export function findFunder(tx: NormalizedTx, wallet: Address): Address | undefined {
  for (const ix of allInstructions(tx)) {
    const t = decodeSystemTransfer(ix);
    if (t && t.to === wallet && t.from !== wallet && t.lamports > 0n) return t.from;
  }
  return undefined;
}

/**
 * Walk a wallet's history back to its first transaction and report who funded it.
 *
 * Very active wallets can have more history than `maxPages` × 1000 signatures. Those come
 * back `unresolvable`, which the scorer treats as "old enough", the safe default: such
 * wallets are not fresh sybils. Swap in an archival source (Helius
 * `getTransactionsForAddress`, BigTable-backed RPC) to resolve them.
 */
export async function resolveFirstFunder(
  rpc: IndexerRpc,
  wallet: Address,
  maxPages = 10,
): Promise<FundingResolution> {
  let oldest: { signature: string; blockTime: number | null } | undefined;
  let pages = 0;
  let exhausted = false;
  for await (const page of signaturePages(rpc, wallet, { maxPages })) {
    pages++;
    const last = page[page.length - 1];
    if (last) oldest = last;
    if (page.length < 1000) exhausted = true;
  }
  if (!oldest) return { status: "unresolvable", reason: "no history" };
  if (!exhausted && pages >= maxPages) {
    return {
      status: "unresolvable",
      reason: `history exceeds ${maxPages} pages`,
      ...(oldest.blockTime !== null ? { oldestSeenAt: oldest.blockTime } : {}),
    };
  }
  const tx = await fetchNormalizedTransaction(rpc, oldest.signature);
  if (!tx) return { status: "unresolvable", reason: "first transaction not available" };
  const funder = findFunder(tx, wallet);
  return {
    status: "resolved",
    firstSeenAt: tx.blockTime ?? oldest.blockTime ?? 0,
    signature: oldest.signature,
    ...(funder ? { firstFunder: funder } : {}),
  };
}
