import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createKeyPairSignerFromBytes } from "@solana/kit";

/** Load a Solana CLI JSON keypair (`[u8; 64]`) as a Kit signer. Node/Bun only. */
export async function loadKeypairSigner(path: string) {
  const resolved = path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;
  const bytes = Uint8Array.from(JSON.parse(readFileSync(resolved, "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}
