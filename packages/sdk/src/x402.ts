import type { TransactionSigner } from "@solana/kit";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";

/**
 * Build a fetch that pays x402 challenges from a Solana signer. Separate entry point
 * (`@ato/sdk/x402`) so read-only consumers don't pull in the x402 stack.
 *
 *   const paidFetch = createX402Fetch(signer);
 *   const client = createTrustOracleClient({ baseUrl, paidFetch });
 *   await client.score(agentId); // pays ~$0.001 in USDC per call
 */
export function createX402Fetch(
  signer: TransactionSigner,
  network = "solana:*",
  baseFetch: typeof fetch = fetch,
) {
  return wrapFetchWithPaymentFromConfig(baseFetch, {
    schemes: [{ network: network as `${string}:${string}`, client: new ExactSvmScheme(signer) }],
  });
}
