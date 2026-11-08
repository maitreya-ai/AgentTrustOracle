import type { FacilitatorClient } from "@x402/core/server";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { MiddlewareHandler } from "hono";

export interface PaywallConfig {
  payTo: string;
  network: string;
  facilitatorUrl: string;
  prices: { score: string; report: string; batch: string };
  /** Inject a facilitator (tests). Defaults to HTTP against `facilitatorUrl`. */
  facilitator?: FacilitatorClient;
}

/**
 * x402 v2 paywall: unpaid requests get HTTP 402 with a PAYMENT-REQUIRED challenge, and
 * paying clients retry with PAYMENT-SIGNATURE. Settlement is a USDC TransferChecked
 * sponsored by the facilitator, so our own API revenue shows up in our own index.
 */
export function paywall(cfg: PaywallConfig): MiddlewareHandler {
  const network = cfg.network as `${string}:${string}`;
  const option = (price: string) => [{ scheme: "exact", price, network, payTo: cfg.payTo }];
  const facilitator = cfg.facilitator ?? new HTTPFacilitatorClient({ url: cfg.facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(network, new ExactSvmScheme());
  return paymentMiddleware(
    {
      "GET /v1/agents/:id/score": {
        accepts: option(cfg.prices.score),
        description: "Agent trust score: score, confidence, flags, organic volume",
        mimeType: "application/json",
      },
      "GET /v1/wallets/:address/score": {
        accepts: option(cfg.prices.score),
        description: "Resolve a payment wallet to its agent and return the trust score",
        mimeType: "application/json",
      },
      "GET /v1/agents/:id/report": {
        accepts: option(cfg.prices.report),
        description: "Full trust report: components, features, linked wallets, wash cycles",
        mimeType: "application/json",
      },
      "POST /v1/scores/batch": {
        accepts: option(cfg.prices.batch),
        description: "Trust scores for up to 50 agents",
        mimeType: "application/json",
      },
    },
    server,
  );
}
