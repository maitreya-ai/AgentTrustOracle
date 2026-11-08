import {
  address,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  type GetSignaturesForAddressApi,
  type GetTransactionApi,
  type Rpc,
  signature,
} from "@solana/kit";
import { fromRpcJson, type NormalizedTx, type RpcJsonTransaction } from "./normalize";

export type IndexerRpc = Rpc<GetSignaturesForAddressApi & GetTransactionApi>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(e: unknown): boolean {
  const status = (e as { context?: { statusCode?: number } })?.context?.statusCode;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  return /\b(429|Too Many Requests|ECONNRESET|ETIMEDOUT|fetch failed)\b/i.test(String(e));
}

/** Honour `Retry-After` (seconds) on 429s when the endpoint sends it. */
function retryAfterMs(e: unknown): number | undefined {
  const headers = (e as { context?: { headers?: Headers } })?.context?.headers;
  const v = headers?.get?.("retry-after");
  const secs = v ? Number(v) : Number.NaN;
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined;
}

/**
 * Solana RPC whose transport retries rate limits (429), 5xx and network resets with
 * exponential backoff + jitter. Public endpoints throttle hard; production should use a
 * dedicated RPC, but ingestion must survive bursts either way.
 */
export function createResilientRpc(
  url: string,
  opts: { retries?: number; baseDelayMs?: number; maxRps?: number } = {},
) {
  const retries = opts.retries ?? 8;
  const base = opts.baseDelayMs ?? 400;
  const spacing = opts.maxRps && opts.maxRps > 0 ? 1000 / opts.maxRps : 0;
  let nextAt = 0;
  // Client-side pacing: public endpoints allow ~40 calls/10s per method.
  const pace = async () => {
    if (spacing === 0) return;
    const now = Date.now();
    const at = Math.max(now, nextAt);
    nextAt = at + spacing;
    if (at > now) await sleep(at - now);
  };
  const inner = createDefaultRpcTransport({ url });
  const transport = (async (...args: Parameters<typeof inner>) => {
    for (let attempt = 0; ; attempt++) {
      await pace();
      try {
        return await inner(...args);
      } catch (e) {
        if (attempt >= retries || !isRetryable(e)) throw e;
        await sleep(retryAfterMs(e) ?? base * 2 ** attempt + Math.random() * base);
      }
    }
  }) as typeof inner;
  return createSolanaRpcFromTransport(transport);
}

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
      // v1 (SIMD-0385) transactions are live; x402 clients may build them.
      maxSupportedTransactionVersion: 1 as 0,
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
