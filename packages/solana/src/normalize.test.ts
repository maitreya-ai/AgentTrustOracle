import { describe, expect, test } from "bun:test";
import { addr } from "@ato/core/testing";
import {
  base58ToBytes,
  bytesToBase58,
  fromGeyser,
  fromRpcJson,
  type RpcJsonTransaction,
} from "./normalize";

const [fee, a, b, prog, loaded] = ["fee", "a", "b", "prog", "loaded"].map(addr) as string[];

const rpcTx: RpcJsonTransaction = {
  slot: 123n,
  blockTime: 1_790_000_000n,
  meta: {
    err: null,
    innerInstructions: [
      {
        index: 0,
        instructions: [
          {
            programIdIndex: 3,
            accounts: [1, 4],
            data: bytesToBase58(new Uint8Array([9])),
            stackHeight: 2,
          },
        ],
      },
    ],
    loadedAddresses: { writable: [loaded as string], readonly: [] },
    preTokenBalances: [
      {
        accountIndex: 1,
        mint: "M",
        owner: b as string,
        uiTokenAmount: { amount: "10", decimals: 6 },
      },
    ],
    postTokenBalances: [
      {
        accountIndex: 1,
        mint: "M",
        owner: b as string,
        uiTokenAmount: { amount: "25", decimals: 6 },
      },
    ],
  },
  transaction: {
    signatures: ["sigX"],
    message: {
      accountKeys: [fee as string, a as string, b as string, prog as string],
      header: { numRequiredSignatures: 1 },
      instructions: [
        { programIdIndex: 3, accounts: [0, 1, 2], data: bytesToBase58(new Uint8Array([1, 2, 3])) },
      ],
    },
  },
};

describe("fromRpcJson", () => {
  test("resolves keys (incl. ALT-loaded), inner instructions and token balances", () => {
    const n = fromRpcJson(rpcTx);
    expect(n.slot).toBe(123);
    expect(n.blockTime).toBe(1_790_000_000);
    expect(n.feePayer).toBe(fee as string);
    expect(n.signers).toEqual([fee as string]);
    expect(n.instructions[0]?.programId).toBe(prog as string);
    expect([...(n.instructions[0]?.data ?? [])]).toEqual([1, 2, 3]);
    expect(n.instructions[0]?.inner[0]?.accounts).toEqual([a as string, loaded as string]);
    expect(n.instructions[0]?.inner[0]?.path).toBe("0.0");
    expect(n.tokenAccounts.get(a as string)).toMatchObject({ owner: b, pre: 10n, post: 25n });
    expect(n.failed).toBe(false);
  });
});

describe("fromGeyser", () => {
  test("maps the Yellowstone protobuf shape onto the same normalized tx", () => {
    const k = (s: string) => base58ToBytes(s);
    const n = fromGeyser(
      {
        slot: "123",
        transaction: {
          signature: base58ToBytes(bytesToBase58(new Uint8Array(64).fill(7))),
          transaction: {
            message: {
              header: { numRequiredSignatures: 1 },
              accountKeys: [fee, a, b, prog].map((x) => k(x as string)),
              instructions: [
                {
                  programIdIndex: 3,
                  accounts: new Uint8Array([0, 1, 2]),
                  data: new Uint8Array([1, 2, 3]),
                },
              ],
            },
          },
          meta: { loadedWritableAddresses: [k(loaded as string)], innerInstructions: [] },
        },
      },
      42,
    );
    expect(n.slot).toBe(123);
    expect(n.blockTime).toBe(42);
    expect(n.instructions[0]?.accounts).toEqual([fee, a, b] as string[]);
    expect(n.accountKeys).toContain(loaded as string);
  });
});
