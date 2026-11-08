/**
 * Pay the score API over real x402 on devnet, using the test payer wallet.
 *
 *   bun run scripts/devnet/pay-api.ts <api-base-url> <path> [count]
 *
 * Prints the response and the settlement transaction from the PAYMENT-RESPONSE header.
 */
import { loadKeypairSigner } from "@ato/sdk/node";
import { createX402Fetch } from "@ato/sdk/x402";

const [base = "http://localhost:8787", path = "/", countArg = "1"] = process.argv.slice(2);
const signer = await loadKeypairSigner(
  process.env.X402_PAYER_KEYPAIR_PATH ?? "./keys/x402-payer.json",
);
const paidFetch = createX402Fetch(signer, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");

for (let i = 0; i < Number(countArg); i++) {
  const res = await paidFetch(`${base}${path}`);
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const settlement = header ? JSON.parse(atob(header)) : null;
  console.log(
    `#${i + 1} ${res.status}`,
    settlement
      ? { tx: settlement.transaction, payer: settlement.payer, success: settlement.success }
      : await res.text(),
  );
}
process.exit(0);
