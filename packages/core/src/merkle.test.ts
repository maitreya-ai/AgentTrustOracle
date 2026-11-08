import { describe, expect, test } from "bun:test";
import {
  buildMerkleTree,
  EMPTY_ROOT,
  encodeLeaf,
  getProof,
  hashLeaf,
  LEAF_SIZE,
  type ScoreLeaf,
  verifyProof,
} from "./merkle";
import { addr } from "./testing";

function leaf(i: number): ScoreLeaf {
  return {
    agent: addr(`agent${i}`),
    registry: i % 3,
    epoch: 7n,
    score: (i * 97) % 1001,
    confidence: (i * 1234) % 10_001,
    flags: i,
    washRatioBps: i * 10,
    uniquePayers: i * 3,
    organicVolume: BigInt(i) * 1_000_000n,
  };
}

describe("merkle", () => {
  test("leaf encoding is 64 bytes with a 0x00 domain prefix", () => {
    const bytes = encodeLeaf(leaf(1));
    expect(bytes.length).toBe(LEAF_SIZE);
    expect(bytes[0]).toBe(0);
  });

  test("empty tree has the zero root", () => {
    expect(buildMerkleTree([]).root).toEqual(EMPTY_ROOT);
  });

  for (const n of [1, 2, 3, 4, 5, 8, 9, 17]) {
    test(`every proof verifies for ${n} leaves`, () => {
      const hashes = Array.from({ length: n }, (_, i) => hashLeaf(leaf(i)));
      const tree = buildMerkleTree(hashes);
      hashes.forEach((h, i) => {
        expect(verifyProof(h, getProof(tree, i), tree.root)).toBe(true);
      });
    });
  }

  test("a tampered leaf fails verification", () => {
    const hashes = Array.from({ length: 6 }, (_, i) => hashLeaf(leaf(i)));
    const tree = buildMerkleTree(hashes);
    const forged = hashLeaf({ ...leaf(2), score: 1000 });
    expect(verifyProof(forged, getProof(tree, 2), tree.root)).toBe(false);
  });
});
