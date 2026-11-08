/**
 * Ensure program keypairs exist and propagate their ids everywhere they are hard-coded:
 * declare_id!, Anchor.toml, the interface crate's PROGRAM_ID bytes and the TS SDK.
 * Like `anchor keys sync`, but also covers the non-Anchor consumers.
 *
 *   bun run program:keys            # create missing keypairs, then sync ids
 *   bun run program:keys --check    # exit 1 if any file is out of sync (CI)
 *
 * Keypairs live in target/deploy/ (gitignored), the location `anchor build/deploy` uses.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addressBytes, encodeAddress } from "@ato/core";

const ROOT = join(import.meta.dir, "..");
const check = process.argv.includes("--check");
const DECLARED: Record<string, string> = {
  trust_oracle: "programs/trust-oracle/src/lib.rs",
  trust_gated_vault: "examples/trust-gated-vault/src/lib.rs",
};

async function ensureKeypair(name: string): Promise<string> {
  const path = join(ROOT, "target/deploy", `${name}-keypair.json`);
  if (existsSync(path)) {
    const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
    return encodeAddress(bytes.slice(32, 64));
  }
  if (check) {
    // CI has no keypairs: fall back to the id declared in source and check consistency.
    const src = readFileSync(join(ROOT, DECLARED[name] as string), "utf8");
    const id = src.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
    if (!id) throw new Error(`no keypair and no declare_id! for ${name}`);
    return id;
  }
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as unknown as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const seed = pkcs8.slice(pkcs8.length - 32);
  mkdirSync(join(ROOT, "target/deploy"), { recursive: true });
  writeFileSync(path, JSON.stringify([...seed, ...pub]));
  console.log(`created ${path}`);
  return encodeAddress(pub);
}

let drift = false;
function rewrite(file: string, pattern: RegExp, replacement: string) {
  const path = join(ROOT, file);
  const before = readFileSync(path, "utf8");
  if (!pattern.test(before)) throw new Error(`${file}: pattern ${pattern} not found`);
  const after = before.replace(pattern, replacement);
  if (after === before) return;
  drift = true;
  if (check) console.error(`out of sync: ${file}`);
  else {
    writeFileSync(path, after);
    console.log(`updated ${file}`);
  }
}

const oracle = await ensureKeypair("trust_oracle");
const vault = await ensureKeypair("trust_gated_vault");
const bytes = [...addressBytes(oracle)].join(", ");

rewrite(
  "programs/trust-oracle/src/lib.rs",
  /declare_id!\("[1-9A-HJ-NP-Za-km-z]+"\)/,
  `declare_id!("${oracle}")`,
);
rewrite(
  "examples/trust-gated-vault/src/lib.rs",
  /declare_id!\("[1-9A-HJ-NP-Za-km-z]+"\)/,
  `declare_id!("${vault}")`,
);
rewrite("Anchor.toml", /trust_oracle = "[1-9A-HJ-NP-Za-km-z]+"/g, `trust_oracle = "${oracle}"`);
rewrite(
  "crates/trust-oracle-interface/src/lib.rs",
  /\/\/\/ `[1-9A-HJ-NP-Za-km-z]+`\n#\[rustfmt::skip\]\npub const PROGRAM_ID: \[u8; 32\] = \[[0-9, ]+\];/,
  `/// \`${oracle}\`\n#[rustfmt::skip]\npub const PROGRAM_ID: [u8; 32] = [${bytes}];`,
);
rewrite(
  "packages/sdk/src/constants.ts",
  /TRUST_ORACLE_PROGRAM_ID = "[1-9A-HJ-NP-Za-km-z]+"/,
  `TRUST_ORACLE_PROGRAM_ID = "${oracle}"`,
);

console.log(`trust_oracle      ${oracle}\ntrust_gated_vault ${vault}`);
if (check && drift) process.exit(1);
