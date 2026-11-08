import { hashLeaf, verifyProof } from "@ato/core";
import type { ProofResponse } from "./api";

const fromHex = (h: string) => {
  const clean = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Check an API proof locally against a root. Use `expectedRoot` from the onchain
 * `ScoreEpoch`, not from the API response: then the API itself does not need to be trusted.
 */
export function verifyScoreProof(p: ProofResponse, expectedRoot: Uint8Array | string): boolean {
  const root = typeof expectedRoot === "string" ? fromHex(expectedRoot) : expectedRoot;
  const leaf = hashLeaf({
    agent: p.leaf.agent,
    registry: p.leaf.registry,
    epoch: BigInt(p.leaf.epoch),
    score: p.leaf.score,
    confidence: p.leaf.confidence,
    flags: p.leaf.flags,
    washRatioBps: p.leaf.washRatioBps,
    uniquePayers: p.leaf.uniquePayers,
    organicVolume: BigInt(p.leaf.organicVolume),
  });
  return verifyProof(leaf, p.proof.map(fromHex), root);
}
