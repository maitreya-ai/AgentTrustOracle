import { describe, expect, test } from "bun:test";
import { addr } from "@ato/core/testing";
import { classifyTransaction } from "./classify";
import { ChannelIx } from "./decode";
import { KNOWN_FACILITATORS } from "./facilitators";
import type { NormalizedInstruction, NormalizedTx, TokenAccountInfo } from "./normalize";
import { PROGRAMS } from "./programs";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAYAI = Object.keys(KNOWN_FACILITATORS).find(
  (k) => KNOWN_FACILITATORS[k] === "PayAI",
) as string;

const le64 = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return [...b];
};

function ix(
  programId: string,
  accounts: string[],
  data: number[],
  path: string,
  inner: NormalizedInstruction[] = [],
): NormalizedInstruction {
  return { programId, accounts, data: new Uint8Array(data), path, inner };
}
const cuLimit = (path: string) => ix(PROGRAMS.computeBudget, [], [2, 0x40, 0x0d, 0x03, 0x00], path);
const cuPrice = (path: string) => ix(PROGRAMS.computeBudget, [], [3, ...le64(1000n)], path);
const memo = (text: string, path: string) =>
  ix(PROGRAMS.memoV2, [], [...new TextEncoder().encode(text)], path);
const transferChecked = (
  src: string,
  dst: string,
  authority: string,
  amount: bigint,
  path: string,
) => ix(PROGRAMS.splToken, [src, USDC, dst, authority], [12, ...le64(amount), 6], path);
const transfer = (src: string, dst: string, authority: string, amount: bigint, path: string) =>
  ix(PROGRAMS.splToken, [src, dst, authority], [3, ...le64(amount)], path);

function tokenAccounts(
  entries: [string, string, bigint?, bigint?][],
): Map<string, TokenAccountInfo> {
  return new Map(
    entries.map(([account, owner, pre = 0n, post = 0n]) => [
      account,
      { owner, mint: USDC, decimals: 6, pre, post },
    ]),
  );
}

function tx(
  feePayer: string,
  instructions: NormalizedInstruction[],
  accounts: Map<string, TokenAccountInfo>,
): NormalizedTx {
  return {
    signature: "sig1",
    slot: 100,
    blockTime: 1_790_000_000,
    failed: false,
    feePayer,
    signers: [feePayer],
    accountKeys: [feePayer],
    instructions,
    tokenAccounts: accounts,
  };
}

const payer = addr("payer");
const merchant = addr("merchant");
const payerAta = addr("payer-ata");
const merchantAta = addr("merchant-ata");
const ctx = { cluster: "mainnet-beta" as const };

describe("x402 exact", () => {
  test("facilitator-sponsored TransferChecked + memo is an x402 payment", () => {
    const t = tx(
      PAYAI,
      [
        cuLimit("0"),
        cuPrice("1"),
        transferChecked(payerAta, merchantAta, payer, 1_000n, "2"),
        memo("a1b2c3d4e5f60718", "3"),
      ],
      tokenAccounts([
        [payerAta, payer],
        [merchantAta, merchant],
      ]),
    );
    const r = classifyTransaction(t, ctx);
    expect(r.payments).toHaveLength(1);
    const p = r.payments[0];
    expect(p?.rail).toBe("x402_exact");
    expect(p?.payer).toBe(payer);
    expect(p?.payee).toBe(merchant);
    expect(p?.usdMicros).toBe(1_000n);
    expect(p?.facilitator).toBe("PayAI");
    expect(p?.memo).toBe("a1b2c3d4e5f60718");
    // Known facilitators are infrastructure, never link evidence.
    expect(r.links).toHaveLength(0);
  });

  test("a wallet paying its own fees is not x402", () => {
    const t = tx(
      payer,
      [
        cuLimit("0"),
        cuPrice("1"),
        transferChecked(payerAta, merchantAta, payer, 1_000n, "2"),
        memo("x", "3"),
      ],
      tokenAccounts([
        [payerAta, payer],
        [merchantAta, merchant],
      ]),
    );
    expect(classifyTransaction(t, ctx).payments).toHaveLength(0);
  });

  test("an unknown sponsor with no memo is left to direct-transfer tracking, with a fee_payer link", () => {
    const relayer = addr("relayer");
    const t = tx(
      relayer,
      [cuLimit("0"), cuPrice("1"), transferChecked(payerAta, merchantAta, payer, 5_000n, "2")],
      tokenAccounts([
        [payerAta, payer],
        [merchantAta, merchant],
      ]),
    );
    const r = classifyTransaction(t, { ...ctx, trackedWallets: new Set([merchant]) });
    expect(r.payments[0]?.rail).toBe("direct_transfer");
    expect(r.links).toEqual([{ from: payer, to: relayer, kind: "fee_payer", evidence: "sig1" }]);
  });

  test("unknown programs disqualify the x402 path", () => {
    const t = tx(
      PAYAI,
      [
        cuLimit("0"),
        transferChecked(payerAta, merchantAta, payer, 1_000n, "1"),
        ix(addr("rando-program"), [], [1], "2"),
      ],
      tokenAccounts([
        [payerAta, payer],
        [merchantAta, merchant],
      ]),
    );
    expect(classifyTransaction(t, ctx).payments).toHaveLength(0);
  });

  test("non-stablecoin mints are ignored", () => {
    const t = tx(
      PAYAI,
      [
        cuLimit("0"),
        ix(
          PROGRAMS.splToken,
          [payerAta, addr("memecoin"), merchantAta, payer],
          [12, ...le64(1n), 6],
          "1",
        ),
        memo("m", "2"),
      ],
      tokenAccounts([
        [payerAta, payer],
        [merchantAta, merchant],
      ]),
    );
    expect(classifyTransaction(t, ctx).payments).toHaveLength(0);
  });

  test("failed transactions produce nothing", () => {
    const t = tx(
      PAYAI,
      [cuLimit("0"), transferChecked(payerAta, merchantAta, payer, 1n, "1"), memo("m", "2")],
      tokenAccounts([[merchantAta, merchant]]),
    );
    expect(classifyTransaction({ ...t, failed: true }, ctx).payments).toHaveLength(0);
  });
});

describe("payment channels", () => {
  const channel = addr("channel");
  const escrow = addr("escrow-ata");
  const treasuryAta = addr("treasury-ata");
  const partner = addr("partner");
  const partnerAta = addr("partner-ata");
  const operator = addr("operator");

  const distributeAccounts = [
    channel,
    payer,
    operator,
    escrow,
    payerAta,
    merchantAta,
    treasuryAta,
    USDC,
    PROGRAMS.splToken,
    addr("event-authority"),
    PROGRAMS.paymentChannels,
    partnerAta,
  ];
  const accounts = tokenAccounts([
    [escrow, channel, 1_000_000n, 0n],
    [payerAta, payer, 0n, 300_000n],
    [merchantAta, merchant, 0n, 630_000n],
    [partnerAta, partner, 0n, 70_000n],
    [treasuryAta, addr("treasury"), 0n, 0n],
  ]);

  test("distribute payouts become payments from the channel payer; refunds are excluded", () => {
    const dist = ix(
      PROGRAMS.paymentChannels,
      distributeAccounts,
      [ChannelIx.distribute, 1, 0, 0, 0],
      "0",
      [
        transfer(escrow, merchantAta, channel, 630_000n, "0.0"),
        transfer(escrow, partnerAta, channel, 70_000n, "0.1"),
        transfer(escrow, payerAta, channel, 300_000n, "0.2"),
      ],
    );
    const r = classifyTransaction(tx(operator, [dist], accounts), ctx);
    expect(r.payments.map((p) => [p.rail, p.payer, p.payee, p.usdMicros])).toEqual([
      ["payment_channel", payer, merchant, 630_000n],
      ["payment_channel", payer, partner, 70_000n],
    ]);
  });

  test("falls back to balance deltas when payouts are batched", () => {
    const dist = ix(
      PROGRAMS.paymentChannels,
      distributeAccounts,
      [ChannelIx.distribute, 1, 0, 0, 0],
      "0",
      [ix(PROGRAMS.splToken, [escrow, merchantAta, partnerAta, channel], [255], "0.0")],
    );
    const r = classifyTransaction(tx(operator, [dist], accounts), ctx);
    const got = new Map(r.payments.map((p) => [p.payee, p.usdMicros]));
    expect(got.get(merchant)).toBe(630_000n);
    expect(got.get(partner)).toBe(70_000n);
    expect(got.has(payer)).toBe(false);
  });

  test("open with a third-party rent payer yields link evidence", () => {
    const open = ix(
      PROGRAMS.paymentChannels,
      [
        payer,
        addr("rent-sponsor"),
        merchant,
        USDC,
        addr("signer"),
        channel,
        payerAta,
        escrow,
        PROGRAMS.splToken,
      ],
      [ChannelIx.open, ...le64(1n), ...le64(1_000_000n), 60, 0, 0, 0, ...le64(99n), 0, 0, 0, 0],
      "0",
    );
    const r = classifyTransaction(tx(payer, [open], new Map()), ctx);
    expect(r.links).toEqual([
      { from: payer, to: addr("rent-sponsor"), kind: "channel_rent_payer", evidence: "sig1" },
    ]);
  });
});
