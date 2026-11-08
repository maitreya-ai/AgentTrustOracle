/**
 * Cross-language parity fixtures. The TypeScript side (SDK + core) writes canonical bytes;
 * the Rust tests (interface crate + program) must reproduce them exactly. Run after changing
 * any layout, then commit the JSON:
 *
 *   bun run fixtures && cargo test --workspace
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addressBytes,
  buildMerkleTree,
  bytesToHex,
  encodeLeaf,
  Flag,
  getProof,
  hashLeaf,
  type ScoreLeaf,
} from "@ato/core";
import { addr } from "@ato/core/testing";
import {
  type AgentScoreAccount,
  checkTrust,
  DISCRIMINATORS,
  encodeAgentScore,
  POLICIES,
  type TrustPolicy,
} from "@ato/sdk";
import { address } from "@solana/kit";

const OUT = join(import.meta.dir, "..", "fixtures");
const hex = (b: Uint8Array) => bytesToHex(b);
const json = (v: unknown) =>
  `${JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)}\n`;

// ── AgentScore account bytes ────────────────────────────────────────────────────────────
const score: AgentScoreAccount = {
  version: 1,
  bump: 253,
  registry: 0,
  agent: address(addr("fixture-agent")),
  score: 742,
  confidence: 9_312,
  flags: Flag.CONCENTRATED_PAYERS | Flag.BURST,
  washRatioBps: 125,
  uniquePayers: 418,
  organicVolume: 12_345_678_901n,
  rawVolume: 13_000_000_000n,
  epoch: 42n,
  updatedSlot: 380_000_123n,
  updatedAt: 1_790_000_000n,
  prevScore: 731,
  methodologyVersion: 1,
};
writeFileSync(
  join(OUT, "agent-score.json"),
  json({
    fields: score,
    agentHex: hex(addressBytes(score.agent)),
    hex: hex(encodeAgentScore(score)),
  }),
);

// ── Merkle leaves, root and proofs ──────────────────────────────────────────────────────
const leaves: ScoreLeaf[] = Array.from({ length: 7 }, (_, i) => ({
  agent: addr(`merkle-agent-${i}`),
  registry: i % 3,
  epoch: 42n,
  score: (i * 137) % 1001,
  confidence: (i * 1_789) % 10_001,
  flags: i === 3 ? Flag.CIRCULAR_FLOW : 0,
  washRatioBps: i * 50,
  uniquePayers: i * 11,
  organicVolume: BigInt(i) * 1_000_000_007n,
}));
const leafHashes = leaves.map(hashLeaf);
const tree = buildMerkleTree(leafHashes);
writeFileSync(
  join(OUT, "merkle.json"),
  json({
    root: hex(tree.root),
    leaves: leaves.map((l, i) => ({
      ...l,
      agentHex: hex(encodeLeaf(l).slice(1, 33)),
      encoded: hex(encodeLeaf(l)),
      hash: hex(leafHashes[i] as Uint8Array),
      proof: getProof(tree, i).map(hex),
    })),
  }),
);

// ── Discriminators ──────────────────────────────────────────────────────────────────────
writeFileSync(
  join(OUT, "discriminators.json"),
  json({
    accounts: Object.fromEntries(
      Object.entries(DISCRIMINATORS.accounts).map(([k, v]) => [k, [...v]]),
    ),
    instructions: Object.fromEntries(
      Object.entries(DISCRIMINATORS.instructions).map(([k, v]) => [k, [...v]]),
    ),
  }),
);

// ── Policy decisions (TS and Rust must agree) ───────────────────────────────────────────
const cases: {
  policy: TrustPolicy;
  score: number;
  confidence: number;
  flags: number;
  updatedSlot: bigint;
  currentSlot: bigint;
}[] = [];
for (const policy of [
  POLICIES.STANDARD,
  POLICIES.STRICT,
  { minScore: 0, minConfidence: 0, maxAgeSlots: 0n, forbiddenFlags: 0 },
]) {
  for (const s of [0, 599, 600, 799, 800, 1000]) {
    for (const c of [0, 4_999, 5_000, 8_000]) {
      for (const f of [0, Flag.SELF_DEALING, Flag.FUNDING_CLUSTER, Flag.BURST]) {
        for (const age of [0n, 432_000n, 432_001n]) {
          cases.push({
            policy,
            score: s,
            confidence: c,
            flags: f,
            updatedSlot: 1_000_000n,
            currentSlot: 1_000_000n + age,
          });
        }
      }
    }
  }
}
writeFileSync(
  join(OUT, "policy-cases.json"),
  json(
    cases.map((c) => ({
      ...c,
      expected: checkTrust(
        { score: c.score, confidence: c.confidence, flags: c.flags, updatedSlot: c.updatedSlot },
        c.policy,
        c.currentSlot,
      ),
    })),
  ),
);

console.log(`wrote fixtures to ${OUT} (${cases.length} policy cases)`);
