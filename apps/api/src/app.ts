import { tierOf } from "@ato/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { proofBody, reportBody, scoreBody } from "./serialize";
import type { ScoreStore } from "./store";
import { type PaywallConfig, paywall } from "./x402";

export interface AppOptions {
  store: ScoreStore;
  /** Omit to serve paid routes for free (local development only). */
  paywall?: PaywallConfig;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const batchSchema = z.object({ agents: z.array(z.string().regex(BASE58)).min(1).max(50) });

export function createApp({ store, paywall: pay }: AppOptions) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "PAYMENT-SIGNATURE", "X-PAYMENT"],
      exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"],
    }),
  );
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  const epochMeta = async () => {
    const e = await store.latestEpoch();
    return { version: e?.methodologyVersion ?? 0, root: e?.merkleRoot ?? "" };
  };
  const validId = (id: string) => BASE58.test(id);

  // ── Free ──────────────────────────────────────────────────────────────────────────────
  app.get("/", (c) =>
    c.json({
      name: "Agent Trust Oracle",
      description: "Payment-grounded trust scores for Solana agents.",
      free: [
        "GET /health",
        "GET /v1/epochs/latest",
        "GET /v1/agents/:id/badge",
        "GET /v1/agents/:id/proof",
        "GET /v1/stats/ecosystem",
      ],
      paid: pay
        ? {
            "GET /v1/agents/:id/score": pay.prices.score,
            "GET /v1/wallets/:address/score": pay.prices.score,
            "GET /v1/agents/:id/report": pay.prices.report,
            "POST /v1/scores/batch": pay.prices.batch,
          }
        : "paywall disabled (dev)",
      network: pay?.network ?? null,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/v1/epochs/latest", async (c) => {
    const e = await store.latestEpoch();
    if (!e) return c.json({ error: "no_epoch" }, 404);
    return c.json({
      epoch: e.epoch.toString(),
      status: e.status,
      asOf: e.asOf.toISOString(),
      merkleRoot: e.merkleRoot,
      methodologyVersion: e.methodologyVersion,
      methodologyHash: e.methodologyHash,
      inputsHash: e.inputsHash,
      agentCount: e.agentCount,
    });
  });

  app.get("/v1/stats/ecosystem", async (c) => {
    const e = await store.latestEpoch();
    if (!e) return c.json({ error: "no_epoch" }, 404);
    return c.json({ epoch: e.epoch.toString(), asOf: e.asOf.toISOString(), stats: e.stats });
  });

  app.get("/v1/agents/:id/badge", async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return c.json({ error: "invalid_id" }, 400);
    const s = await store.latestScore(id);
    return c.json({
      agent: id,
      tier: s ? tierOf(s.score, s.confidence) : "unrated",
      epoch: s?.epoch.toString() ?? null,
    });
  });

  app.get("/v1/agents/:id/proof", async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return c.json({ error: "invalid_id" }, 400);
    const s = await store.latestScore(id);
    if (!s) return c.json({ error: "not_found" }, 404);
    return c.json(proofBody(s, (await epochMeta()).root));
  });

  // ── Paid (x402) ───────────────────────────────────────────────────────────────────────
  if (pay) app.use(paywall(pay));

  app.get("/v1/agents/:id/score", async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return c.json({ error: "invalid_id" }, 400);
    const s = await store.latestScore(id);
    if (!s) return c.json({ error: "not_found" }, 404);
    return c.json(scoreBody(s, (await epochMeta()).version));
  });

  app.get("/v1/wallets/:address/score", async (c) => {
    const address = c.req.param("address");
    if (!validId(address)) return c.json({ error: "invalid_address" }, 400);
    const agent = await store.agentForWallet(address);
    const s = agent ? await store.latestScore(agent) : null;
    if (!s) return c.json({ error: "not_found" }, 404);
    return c.json(scoreBody(s, (await epochMeta()).version));
  });

  app.get("/v1/agents/:id/report", async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return c.json({ error: "invalid_id" }, 400);
    const s = await store.latestScore(id);
    if (!s) return c.json({ error: "not_found" }, 404);
    return c.json(reportBody(s, (await epochMeta()).version));
  });

  app.post("/v1/scores/batch", async (c) => {
    const parsed = batchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    const { version } = await epochMeta();
    const found = await Promise.all(parsed.data.agents.map((id) => store.latestScore(id)));
    return c.json({
      scores: found.filter((s) => s !== null).map((s) => scoreBody(s, version)),
      missing: parsed.data.agents.filter((_, i) => found[i] === null),
    });
  });

  return app;
}
