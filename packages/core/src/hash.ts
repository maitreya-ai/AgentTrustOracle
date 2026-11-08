import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import type { Address } from "./types";

export { bytesToHex, sha256 };

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

/** Decode a base58 address to its 32 raw bytes, rejecting anything else. */
export function addressBytes(address: Address): Uint8Array {
  const bytes = base58.decode(address);
  if (bytes.length !== 32) {
    throw new Error(`invalid address ${address}: expected 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

export function encodeAddress(bytes: Uint8Array): Address {
  return base58.encode(bytes);
}

/**
 * Canonical JSON with sorted object keys and bigint values as decimal strings. Used for
 * methodology and input hashes, so equal values always produce identical bytes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
