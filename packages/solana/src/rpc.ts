import {
  address,
  type GetSignaturesForAddressApi,
  type GetTransactionApi,
  type Rpc,
  signature,
} from "@solana/kit";
import { fromRpcJson, type NormalizedTx, type RpcJsonTransaction } from "./normalize";

export type IndexerRpc = Rpc<GetSignaturesForAddressApi & GetTransactionApi>;

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  failed: boolean;
}

/**
 * Page an address's signatures newest → oldest. Stops at `until` (exclusive), after
 * `maxPages`, or when history is exhausted.
 */
export async function* signaturePages(
  rpc: IndexerRpc,
  addr: string,
  opts: { before?: string; until?: string; pageSize?: number; maxPages?: number } = {},
): AsyncGenerator<SignatureInfo[]> {
  let before = opts.before;
  const pageSize = opts.pageSize ?? 1000;
  for (let page = 0; page < (opts.maxPages ?? Number.POSITIVE_INFINITY); page++) {
    const res = await rpc
      .getSignaturesForAddress(address(addr), {
        limit: pageSize,
        commitment: "confirmed",
        ...(before ? { before: signature(before) } : {}),
        ...(opts.until ? { until: signature(opts.until) } : {}),
      })
      .send();
    if (res.length === 0) return;
    yield res.map((r) => ({
      signature: r.signature,
      slot: Number(r.slot),
      blockTime: r.blockTime === null ? null : Number(r.blockTime),
      failed: r.err !== null,
    }));
    if (res.length < pageSize) return;
    before = res[res.length - 1]?.signature;
  }
}

export async function fetchNormalizedTransaction(
  rpc: IndexerRpc,
  sig: string,
): Promise<NormalizedTx | null> {
  const tx = await rpc
    .getTransaction(signature(sig), {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    })
    .send();
  if (!tx) return null;
  // Kit's response type is a deep union over encodings; the json shape is what we asked for.
  return fromRpcJson(tx as unknown as RpcJsonTransaction);
}

/** Minimal concurrency limiter for fan-out RPC calls (no extra dependency). */
export function limiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}
