import { describe, expect, test } from "bun:test";
import { runEpoch } from "@ato/core";
import { addr, syntheticEconomy } from "@ato/core/testing";
import { verifyScoreProof } from "@ato/sdk";
import type { FacilitatorClient } from "@x402/core/server";
import { createApp } from "./app";
import { memoryStore } from "./store";

// biome-ignore lint/suspicious/noExplicitAny: assertions walk untyped JSON bodies
const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const result = runEpoch(syntheticEconomy());
const store = memoryStore(result);
const honest = addr("honest-asset");
const wash = addr("wash-asset");

describe("free routes", () => {
  const app = createApp({ store });

  test("index lists endpoints", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect((await json(res)).free).toContain("GET /v1/agents/:id/badge");
  });

  test("badge returns a tier", async () => {
    const body = await json(app.request(`/v1/agents/${honest}/badge`));
    expect(body.tier).toBe("gold");
  });

  test("unknown agents are unrated, malformed ids rejected", async () => {
    expect((await json(app.request(`/v1/agents/${addr("nobody")}/badge`))).tier).toBe("unrated");
    expect((await app.request("/v1/agents/not-an-address/badge")).status).toBe(400);
  });

  test("proofs verify against the epoch root without trusting the API", async () => {
    const proof = await json(app.request(`/v1/agents/${honest}/proof`));
    expect(verifyScoreProof(proof, result.merkleRoot)).toBe(true);
    expect(
      verifyScoreProof({ ...proof, leaf: { ...proof.leaf, score: 1000 } }, result.merkleRoot),
    ).toBe(false);
  });

  test("ecosystem stats expose raw vs organic volume", async () => {
    const body = await json(app.request("/v1/stats/ecosystem"));
    expect(Number(body.stats.organicVolumeMicros)).toBeLessThan(Number(body.stats.rawVolumeMicros));
  });
});

describe("paid routes with the paywall disabled (dev)", () => {
  const app = createApp({ store });

  test("score includes decoded flags", async () => {
    const body = await json(app.request(`/v1/agents/${wash}/score`));
    expect(body.flagNames).toContain("CIRCULAR_FLOW");
    expect(body.score).toBeLessThan(50);
  });

  test("report includes wash cycle evidence", async () => {
    const body = await json(app.request(`/v1/agents/${wash}/report`));
    expect(body.evidence.cycles[0].wash).toBe(true);
  });

  test("batch validates input and reports missing agents", async () => {
    const bad = await app.request("/v1/scores/batch", { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);
    const missing = addr("missing");
    const res = await app.request("/v1/scores/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agents: [honest, missing] }),
    });
    const body = await json(res);
    expect(body.scores).toHaveLength(1);
    expect(body.missing).toEqual([missing]);
  });
});

describe("paid routes behind x402", () => {
  const feePayer = addr("facilitator-fee-payer");
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: DEVNET, extra: { feePayer } }],
      extensions: [],
      signers: { "solana:*": [feePayer] },
    }),
    verify: async () => ({ isValid: false, invalidReason: "test" }),
    settle: async () => ({ success: false, transaction: "", network: DEVNET, errorReason: "test" }),
  };
  const app = createApp({
    store,
    paywall: {
      payTo: addr("oracle-treasury"),
      network: DEVNET,
      facilitatorUrl: "http://unused",
      prices: { score: "$0.001", report: "$0.01", batch: "$0.02" },
      facilitator,
    },
  });

  test("unpaid requests get a 402 with a PAYMENT-REQUIRED challenge", async () => {
    const res = await app.request(`/v1/agents/${honest}/score`);
    expect(res.status).toBe(402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header).toBeTruthy();
    const challenge = JSON.parse(atob(header as string));
    expect(challenge.x402Version).toBe(2);
    expect(challenge.accepts[0].network).toBe(DEVNET);
    expect(challenge.accepts[0].amount).toBe("1000"); // $0.001 in USDC base units
  });

  test("free routes stay free", async () => {
    expect((await app.request(`/v1/agents/${honest}/badge`)).status).toBe(200);
  });
});
