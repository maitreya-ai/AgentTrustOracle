import { addressBytes, bytesToHex, sha256 } from "./hash";
import type { Address } from "./types";

/**
 * Epoch score commitments. MUST match `crates/trust-oracle-interface::encode_leaf` and the
 * program's `verify_score_proof` byte for byte (checked against `fixtures/merkle.json`).
 *
 *   leaf = sha256(0x00 || agent[32] || registry u8 || epoch u64 || score u16 ||
 *                 confidence u16 || flags u32 || wash_ratio_bps u16 || unique_payers u32 ||
 *                 organic_volume u64)                     (all integers little-endian)
 *   node = sha256(0x01 || min(a, b) || max(a, b))         (sorted pair: no direction bits)
 *
 * Domain-separation prefixes stop a 64-byte leaf being passed off as an inner node. An odd
 * node at the end of a layer is promoted unchanged.
 */
export interface ScoreLeaf {
  agent: Address;
  registry: number;
  epoch: bigint;
  score: number;
  confidence: number;
  flags: number;
  washRatioBps: number;
  uniquePayers: number;
  organicVolume: bigint;
}

export const LEAF_SIZE = 64;
const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

export function encodeLeaf(leaf: ScoreLeaf): Uint8Array {
  const buf = new Uint8Array(LEAF_SIZE);
  const view = new DataView(buf.buffer);
  let o = 0;
  buf[o++] = LEAF_PREFIX;
  buf.set(addressBytes(leaf.agent), o);
  o += 32;
  view.setUint8(o, leaf.registry);
  o += 1;
  view.setBigUint64(o, leaf.epoch, true);
  o += 8;
  view.setUint16(o, leaf.score, true);
  o += 2;
  view.setUint16(o, leaf.confidence, true);
  o += 2;
  view.setUint32(o, leaf.flags >>> 0, true);
  o += 4;
  view.setUint16(o, leaf.washRatioBps, true);
  o += 2;
  view.setUint32(o, leaf.uniquePayers >>> 0, true);
  o += 4;
  view.setBigUint64(o, leaf.organicVolume, true);
  o += 8;
  if (o !== LEAF_SIZE) throw new Error(`leaf encoding size mismatch: ${o}`);
  return buf;
}

export function hashLeaf(leaf: ScoreLeaf): Uint8Array {
  return sha256(encodeLeaf(leaf));
}

export function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const buf = new Uint8Array(65);
  buf[0] = NODE_PREFIX;
  buf.set(lo, 1);
  buf.set(hi, 33);
  return sha256(buf);
}

export interface MerkleTree {
  root: Uint8Array;
  layers: Uint8Array[][];
}

export const EMPTY_ROOT = new Uint8Array(32);

export function buildMerkleTree(leafHashes: readonly Uint8Array[]): MerkleTree {
  if (leafHashes.length === 0) return { root: EMPTY_ROOT, layers: [[]] };
  const layers: Uint8Array[][] = [[...leafHashes]];
  while ((layers[layers.length - 1] as Uint8Array[]).length > 1) {
    const prev = layers[layers.length - 1] as Uint8Array[];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i] as Uint8Array;
      const right = prev[i + 1];
      next.push(right ? hashPair(left, right) : left);
    }
    layers.push(next);
  }
  return { root: (layers[layers.length - 1] as Uint8Array[])[0] as Uint8Array, layers };
}

export function getProof(tree: MerkleTree, index: number): Uint8Array[] {
  const proof: Uint8Array[] = [];
  let i = index;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level] as Uint8Array[];
    const sibling = layer[i % 2 === 0 ? i + 1 : i - 1];
    if (sibling) proof.push(sibling);
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(
  leafHash: Uint8Array,
  proof: readonly Uint8Array[],
  root: Uint8Array,
): boolean {
  let acc = leafHash;
  for (const p of proof) acc = hashPair(acc, p);
  return compareBytes(acc, root) === 0;
}

export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}
