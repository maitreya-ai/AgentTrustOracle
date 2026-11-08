import { describe, expect, test } from "bun:test";
import { addressBytes } from "@ato/core";
import { addr } from "@ato/core/testing";
import { AGENT_ACCOUNT_DISCRIMINATOR, decodeErc8004Agent, toAgentIdentity } from "./erc8004";

/** Borsh-encode an AgentAccount the way the 8004 program lays it out. */
function encode(opts: { wallet?: string; parent?: string; uri: string }) {
  const parts: number[] = [...AGENT_ACCOUNT_DISCRIMINATOR];
  const pk = (s: string) => parts.push(...addressBytes(s));
  const u64 = (v: bigint) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v, true);
    parts.push(...b);
  };
  const str = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, true);
    parts.push(...len, ...bytes);
  };
  const opt = (s?: string) => {
    if (s) {
      parts.push(1);
      pk(s);
    } else parts.push(0);
  };
  pk(addr("collection"));
  pk(addr("creator"));
  pk(addr("owner"));
  pk(addr("asset"));
  parts.push(254, 1); // bump, atom_enabled
  opt(opts.wallet);
  parts.push(...new Uint8Array(32));
  u64(7n);
  parts.push(...new Uint8Array(32));
  u64(0n);
  parts.push(...new Uint8Array(32));
  u64(0n);
  opt(opts.parent);
  parts.push(0, 0);
  str(opts.uri);
  str("Agent #1");
  str("");
  return new Uint8Array(parts);
}

describe("8004 AgentAccount", () => {
  test("decodes fixed and variable fields", () => {
    const a = decodeErc8004Agent(
      encode({ wallet: addr("agent-wallet"), parent: addr("parent"), uri: "ipfs://card" }),
    );
    expect(a.asset).toBe(addr("asset"));
    expect(a.owner).toBe(addr("owner"));
    expect(a.agentWallet).toBe(addr("agent-wallet"));
    expect(a.parentAsset).toBe(addr("parent"));
    expect(a.feedbackCount).toBe(7n);
    expect(a.agentUri).toBe("ipfs://card");
    expect(a.nftName).toBe("Agent #1");
  });

  test("operational wallet is primary; owner only as fallback", () => {
    const withWallet = toAgentIdentity(
      decodeErc8004Agent(encode({ wallet: addr("agent-wallet"), uri: "" })),
    );
    expect(withWallet.wallets).toEqual([addr("agent-wallet")]);
    const without = toAgentIdentity(decodeErc8004Agent(encode({ uri: "" })));
    expect(without.wallets).toEqual([addr("owner")]);
  });

  test("rejects foreign accounts", () => {
    const bad = encode({ uri: "" });
    bad[0] = (bad[0] as number) ^ 0xff;
    expect(() => decodeErc8004Agent(bad)).toThrow(/discriminator/);
  });
});
