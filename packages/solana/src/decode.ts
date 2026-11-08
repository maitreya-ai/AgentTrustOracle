import type { Address } from "@ato/core";
import type { NormalizedInstruction } from "./normalize";
import { MEMO_PROGRAMS, PROGRAMS, TOKEN_PROGRAMS } from "./programs";

const u64 = (d: Uint8Array, o: number) =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);
const u32 = (d: Uint8Array, o: number) =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o, true);
const u16 = (d: Uint8Array, o: number) =>
  new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(o, true);

// ── SPL Token / Token-2022 (shared layouts for the instructions we read) ────────────────────

export interface TokenTransfer {
  kind: "transfer" | "transferChecked";
  source: Address;
  destination: Address;
  authority: Address;
  mint?: Address;
  amount: bigint;
  decimals?: number;
}

const TOKEN_TRANSFER = 3;
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_TRANSFER_CHECKED = 12;

export function decodeTokenTransfer(ix: NormalizedInstruction): TokenTransfer | null {
  if (!TOKEN_PROGRAMS.has(ix.programId) || ix.data.length === 0) return null;
  const tag = ix.data[0];
  if (tag === TOKEN_TRANSFER && ix.data.length >= 9 && ix.accounts.length >= 3) {
    const [source, destination, authority] = ix.accounts as [Address, Address, Address];
    return { kind: "transfer", source, destination, authority, amount: u64(ix.data, 1) };
  }
  if (tag === TOKEN_TRANSFER_CHECKED && ix.data.length >= 10 && ix.accounts.length >= 4) {
    const [source, mint, destination, authority] = ix.accounts as [
      Address,
      Address,
      Address,
      Address,
    ];
    return {
      kind: "transferChecked",
      source,
      mint,
      destination,
      authority,
      amount: u64(ix.data, 1),
      decimals: ix.data[9] as number,
    };
  }
  return null;
}

export interface TokenClose {
  account: Address;
  destination: Address;
  owner: Address;
}

export function decodeTokenClose(ix: NormalizedInstruction): TokenClose | null {
  if (!TOKEN_PROGRAMS.has(ix.programId) || ix.data[0] !== TOKEN_CLOSE_ACCOUNT) return null;
  const [account, destination, owner] = ix.accounts;
  if (!account || !destination || !owner) return null;
  return { account, destination, owner };
}

// ── System program ──────────────────────────────────────────────────────────────────────

export interface SystemTransfer {
  from: Address;
  to: Address;
  lamports: bigint;
}

/** SystemInstruction::Transfer (2) and CreateAccount (0). Both fund a new wallet. */
export function decodeSystemTransfer(ix: NormalizedInstruction): SystemTransfer | null {
  if (ix.programId !== PROGRAMS.system || ix.data.length < 12) return null;
  const tag = u32(ix.data, 0);
  const [from, to] = ix.accounts;
  if (!from || !to) return null;
  if (tag === 2) return { from, to, lamports: u64(ix.data, 4) };
  if (tag === 0) return { from, to, lamports: u64(ix.data, 4) };
  return null;
}

// ── Compute budget / memo ───────────────────────────────────────────────────────────────

export function isComputeBudget(ix: NormalizedInstruction): boolean {
  return ix.programId === PROGRAMS.computeBudget;
}

export function decodeMemo(ix: NormalizedInstruction): string | null {
  if (!MEMO_PROGRAMS.has(ix.programId)) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(ix.data);
}

// ── Solana Foundation payment channels (CHNLxYv…) ───────────────────────────────────────
// Layouts per solana-foundation/payment-channels docs/003-program-instructions.md.

export const ChannelIx = {
  open: 1,
  settle: 2,
  topUp: 3,
  settleAndSeal: 4,
  requestClose: 5,
  seal: 6,
  distribute: 7,
  withdrawPayer: 8,
  reclaim: 9,
  emitEvent: 228,
} as const;

export interface ChannelOpen {
  payer: Address;
  rentPayer: Address;
  payee: Address;
  mint: Address;
  authorizedSigner: Address;
  channel: Address;
  salt: bigint;
  deposit: bigint;
  gracePeriod: number;
  openSlot: bigint;
  recipients: { recipient: Uint8Array; bps: number }[];
}

export function decodeChannelOpen(ix: NormalizedInstruction): ChannelOpen | null {
  if (ix.programId !== PROGRAMS.paymentChannels || ix.data[0] !== ChannelIx.open) return null;
  if (ix.data.length < 1 + 8 + 8 + 4 + 8 + 4 || ix.accounts.length < 8) return null;
  const [payer, rentPayer, payee, mint, authorizedSigner, channel] = ix.accounts as Address[];
  const count = u32(ix.data, 29);
  const recipients: ChannelOpen["recipients"] = [];
  for (let i = 0; i < count; i++) {
    const o = 33 + i * 34;
    if (o + 34 > ix.data.length) return null;
    recipients.push({ recipient: ix.data.slice(o, o + 32), bps: u16(ix.data, o + 32) });
  }
  return {
    payer: payer as Address,
    rentPayer: rentPayer as Address,
    payee: payee as Address,
    mint: mint as Address,
    authorizedSigner: authorizedSigner as Address,
    channel: channel as Address,
    salt: u64(ix.data, 1),
    deposit: u64(ix.data, 9),
    gracePeriod: u32(ix.data, 17),
    openSlot: u64(ix.data, 21),
    recipients,
  };
}

export interface ChannelDistributeAccounts {
  channel: Address;
  payer: Address;
  rentPayer: Address;
  channelTokenAccount: Address;
  payerTokenAccount: Address;
  payeeTokenAccount: Address;
  treasuryTokenAccount: Address;
  mint: Address;
}

export function decodeChannelDistribute(
  ix: NormalizedInstruction,
): ChannelDistributeAccounts | null {
  if (ix.programId !== PROGRAMS.paymentChannels || ix.data[0] !== ChannelIx.distribute) return null;
  if (ix.accounts.length < 11) return null;
  const a = ix.accounts as Address[];
  return {
    channel: a[0] as Address,
    payer: a[1] as Address,
    rentPayer: a[2] as Address,
    channelTokenAccount: a[3] as Address,
    payerTokenAccount: a[4] as Address,
    payeeTokenAccount: a[5] as Address,
    treasuryTokenAccount: a[6] as Address,
    mint: a[7] as Address,
  };
}
