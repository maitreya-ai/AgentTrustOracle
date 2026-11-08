import { fromGeyser, type GeyserTransactionUpdate } from "@ato/solana";
import type { IndexerContext } from "./context";
import { persist } from "./ingest";

/**
 * Live ingestion over Helius LaserStream (Yellowstone-compatible gRPC). Loaded lazily so the
 * native module is only needed when streaming is configured.
 */
export async function stream(ctx: IndexerContext) {
  const { LASERSTREAM_ENDPOINT: endpoint, LASERSTREAM_API_KEY: apiKey } = ctx.env;
  if (!endpoint || !apiKey)
    throw new Error("LASERSTREAM_ENDPOINT and LASERSTREAM_API_KEY are required");
  const ls = (await import("helius-laserstream")) as unknown as {
    subscribe: (
      config: { apiKey: string; endpoint: string },
      request: unknown,
      onData: (u: { transaction?: GeyserTransactionUpdate }) => Promise<void>,
      onError: (e: Error) => void,
    ) => Promise<{ cancel(): void }>;
    CommitmentLevel: { CONFIRMED: number };
  };

  const request = {
    transactions: {
      ato: {
        vote: false,
        failed: false,
        accountInclude: ctx.watched,
        accountExclude: [],
        accountRequired: [],
      },
    },
    commitment: ls.CommitmentLevel.CONFIRMED,
    accounts: {},
    slots: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
  };

  let buffer: ReturnType<typeof fromGeyser>[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const r = await persist(ctx, batch);
    if (r.payments > 0) console.log(`[stream] +${r.payments} payments`);
  };
  setInterval(() => void flush().catch((e) => console.error("[stream] flush", e)), 2_000);

  // gRPC tx updates carry no block time: stamp with receipt time (seconds of skew).
  await ls.subscribe(
    { apiKey, endpoint },
    request,
    async (update) => {
      if (!update.transaction) return;
      try {
        buffer.push(fromGeyser(update.transaction, Math.floor(Date.now() / 1000)));
      } catch (e) {
        console.warn("[stream] skip update", e);
      }
    },
    (e) => console.error("[stream] error", e),
  );
  console.log(`[stream] subscribed to ${ctx.watched.length} addresses`);
}
