import type { Address } from "@ato/core";

/**
 * Known x402 facilitator fee payers on Solana mainnet.
 *
 * Source: github.com/PaulieB14/x402-solana-pulse `src/lib.rs`, which says it mirrors the
 * x402scan registry. Verify against x402scan and each facilitator's `GET /supported`
 * (`signers["solana:*"]`) before production use, and refresh regularly. Facilitators rotate keys.
 *
 * These addresses matter for correctness in two ways:
 *  1. Labelling: a sponsored TransferChecked whose fee payer is listed here is an x402 payment.
 *  2. Clustering: a facilitator sponsors thousands of unrelated payers, so it must NEVER be
 *     treated as a `fee_payer` link. All of these are passed to the scorer as infrastructure.
 */
export const KNOWN_FACILITATORS: Readonly<Record<Address, string>> = {
  "34DmdeSbEnng2bmbSj9ActckY49km2HdhiyAwyXZucqP": "AnySpend",
  "8x8CzkTHTYkW18frrTR7HdCV6fsjenvcykJAXWvoPQW": "Aurracloud",
  PcTZWki36z5Y82TAATKK48XUdfsgmS5oLkw2Ta7vWyK: "Bitrefill",
  "7NetKx8TuRMBpqYFKZCVetkNuvWCPTrgekmGrsJwTmfN": "Cascade",
  HsozMJWWHNADoZRmhDGKzua6XW6NNfNDdQ4CkE9i5wHt: "CodeNut",
  L54zkaPQFeTn1UsEqieEXBqWrPShiaZEPD7mS5WXfQg: "Coinbase",
  BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP: "Coinbase",
  BFK9TLC3edb13K6v4YyH3DwPb5DSUpkWvb7XnqCL9b4F: "Coinbase",
  D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM: "Coinbase",
  GVJJ7rdGiXr5xaYbRwRbjfaJL7fmwRygFi1H6aGqDveb: "Coinbase",
  Hc3sdEAsCGQcpgfivywog9uwtk8gUBUZgsxdME1EJy88: "Coinbase",
  AepWpq3GQwL8CeKMtZyKtKPa7W91Coygh3ropAJapVdU: "Corbits",
  DuQ4jFMmVABWGxabYHFkGzdyeJgS1hp4wrRuCtsJgT9a: "Daydreams",
  DEXVS3su4dZQWTvvPnLDJLRK1CeeKG6K3QqdzthgAkNV: "Dexter",
  Hbe1vdFs4EQVVAzcV12muHhr6DEKwrT9roMXGPLxLBLP: "OpenFacilitator",
  "5xvht4fYDs99yprfm4UeuHSLxMBRpotfBtUCQqM3oDNG": "OpenX402",
  "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4": "PayAI",
  CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww: "PayAI",
  "8B5UKhwfAyFW67h58cBkQj1Ur6QXRgwWJJcQp8ZBsDPa": "PayAI",
  "4x4ZhcqiT1FnirM8Ne97iVupkN4NcQgc2YYbE2jDZbZn": "Relai",
  F742C4VfFLQ9zRQyithoj5229ZgtX2WqKCSFKgH2EThq: "UltravioletaDAO",
  "561oabzy81vXYYbs1ZHR1bvpiEr6Nbfd6PGTxPshoz4p": "X402Jobs",
};

export function facilitatorLabel(feePayer: Address): string | undefined {
  return KNOWN_FACILITATORS[feePayer];
}
