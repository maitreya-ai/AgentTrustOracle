import type { Address, Payment, WalletLink } from "@ato/core";
import {
  decodeChannelDistribute,
  decodeChannelOpen,
  decodeMemo,
  decodeTokenClose,
  decodeTokenTransfer,
  isComputeBudget,
} from "./decode";
import { facilitatorLabel } from "./facilitators";
import { allInstructions, type NormalizedInstruction, type NormalizedTx } from "./normalize";
import {
  type Cluster,
  MEMO_PROGRAMS,
  PROGRAMS,
  type Stablecoin,
  TOKEN_PROGRAMS,
  toUsdMicros,
} from "./programs";

export interface ClassifyContext {
  cluster: Cluster;
  /** Agent wallets: any stablecoin transfer touching one is captured as `direct_transfer`. */
  trackedWallets?: ReadonlySet<Address>;
  /** Addresses never used as link evidence (facilitators, operators, treasuries). */
  infrastructure?: ReadonlySet<Address>;
  extraStablecoins?: Record<Address, Stablecoin>;
  /** Fallback block time (unix seconds) when the source omits it, e.g. live gRPC. */
  now?: () => number;
}

export interface ClassifiedPayment extends Payment {
  memo?: string;
}

export interface Classification {
  payments: ClassifiedPayment[];
  links: WalletLink[];
  /** Human-readable diagnostics: things seen but not attributable. */
  notes: string[];
}

/** Top-level programs the x402 exact-SVM spec allows in a Path-1 payment transaction. */
const X402_ALLOWED = new Set<string>([
  PROGRAMS.computeBudget,
  PROGRAMS.splToken,
  PROGRAMS.token2022,
  PROGRAMS.associatedToken,
  PROGRAMS.memoV1,
  PROGRAMS.memoV2,
  PROGRAMS.lighthouse,
]);

/**
 * Classify one transaction into payments and wallet-link evidence. Failed transactions
 * produce nothing. Each token-transfer instruction is attributed to at most one rail, in
 * priority order: payment channel, then x402 exact, then direct transfer.
 */
export function classifyTransaction(tx: NormalizedTx, ctx: ClassifyContext): Classification {
  const out: Classification = { payments: [], links: [], notes: [] };
  if (tx.failed) return out;
  const consumed = new Set<string>();
  const blockTime = tx.blockTime ?? ctx.now?.() ?? Math.floor(Date.now() / 1000);

  classifyChannels(tx, ctx, blockTime, consumed, out);
  classifyX402Exact(tx, ctx, blockTime, consumed, out);
  classifyDirect(tx, ctx, blockTime, consumed, out);
  collectCloseLinks(tx, ctx, out);
  return out;
}

// ── x402 exact ──────────────────────────────────────────────────────────────────────────

function classifyX402Exact(
  tx: NormalizedTx,
  ctx: ClassifyContext,
  blockTime: number,
  consumed: Set<string>,
  out: Classification,
): void {
  const top = tx.instructions;
  if (top.length === 0 || !top.every((ix) => X402_ALLOWED.has(ix.programId))) return;
  if (!top.some(isComputeBudget)) return;

  const transfers = top
    .map((ix) => ({ ix, t: decodeTokenTransfer(ix) }))
    .filter(
      (x): x is { ix: NormalizedInstruction; t: NonNullable<typeof x.t> } =>
        x.t?.kind === "transferChecked",
    );
  if (transfers.length === 0) return;

  // Fee-payer isolation (spec §2.1.1): the sponsor never appears in a non-ATA instruction
  // and is never the transfer authority.
  const feePayer = tx.feePayer;
  for (const ix of top) {
    if (ix.programId !== PROGRAMS.associatedToken && ix.accounts.includes(feePayer)) return;
  }
  if (transfers.some(({ t }) => t.authority === feePayer)) return;

  const memoIx = top.find((ix) => MEMO_PROGRAMS.has(ix.programId));
  const memo = memoIx ? (decodeMemo(memoIx) ?? undefined) : undefined;
  const facilitator = facilitatorLabel(feePayer);
  // A sponsored transfer with neither a known facilitator nor a memo is probably a gasless
  // wallet relay, not x402. Leave it to the direct-transfer pass.
  if (!facilitator && memo === undefined) return;

  for (const { ix, t } of transfers) {
    const dest = tx.tokenAccounts.get(t.destination);
    const src = tx.tokenAccounts.get(t.source);
    const mint = t.mint ?? dest?.mint;
    const payee = dest?.owner;
    if (!mint || !payee) {
      out.notes.push(`x402 ${tx.signature}:${ix.path}: destination owner unknown`);
      continue;
    }
    const usd = toUsdMicros(ctx.cluster, mint, t.amount, ctx.extraStablecoins);
    if (usd === null) continue;
    const payer = src?.owner ?? t.authority;
    consumed.add(ix.path);
    out.payments.push({
      id: `${tx.signature}:${ix.path}`,
      signature: tx.signature,
      slot: tx.slot,
      blockTime,
      rail: "x402_exact",
      payer,
      payee,
      mint,
      amount: t.amount,
      usdMicros: usd,
      feePayer,
      ...(facilitator ? { facilitator } : {}),
      ...(memo !== undefined ? { memo } : {}),
    });
    if (!facilitator && !ctx.infrastructure?.has(feePayer)) {
      out.links.push({ from: payer, to: feePayer, kind: "fee_payer", evidence: tx.signature });
    }
  }
}

// ── Payment channels ────────────────────────────────────────────────────────────────────

function classifyChannels(
  tx: NormalizedTx,
  ctx: ClassifyContext,
  blockTime: number,
  consumed: Set<string>,
  out: Classification,
): void {
  const channelIxs = allInstructions(tx).filter((ix) => ix.programId === PROGRAMS.paymentChannels);
  if (channelIxs.length === 0) return;
  const distributes = channelIxs.filter((ix) => decodeChannelDistribute(ix) !== null);

  for (const ix of channelIxs) {
    const open = decodeChannelOpen(ix);
    if (open && open.rentPayer !== open.payer && !ctx.infrastructure?.has(open.rentPayer)) {
      out.links.push({
        from: open.payer,
        to: open.rentPayer,
        kind: "channel_rent_payer",
        evidence: tx.signature,
      });
    }

    const dist = decodeChannelDistribute(ix);
    if (!dist) continue;
    const excluded = new Set([
      dist.payerTokenAccount,
      dist.treasuryTokenAccount,
      dist.channelTokenAccount,
    ]);

    const pushPayout = (path: string, destination: Address, amount: bigint) => {
      const info = tx.tokenAccounts.get(destination);
      const payee = info?.owner;
      if (!payee) {
        out.notes.push(`channel ${tx.signature}:${path}: payout owner unknown`);
        return;
      }
      const usd = toUsdMicros(ctx.cluster, dist.mint, amount, ctx.extraStablecoins);
      if (usd === null || amount === 0n) return;
      out.payments.push({
        id: `${tx.signature}:${path}`,
        signature: tx.signature,
        slot: tx.slot,
        blockTime,
        rail: "payment_channel",
        payer: dist.payer,
        payee,
        mint: dist.mint,
        amount,
        usdMicros: usd,
        feePayer: tx.feePayer,
      });
    };

    // Preferred: explicit transfer CPIs out of the escrow, nested under this instruction.
    const parent = tx.instructions.find((t) => t === ix);
    const transfers = (parent?.inner ?? [])
      .map((inner) => ({ inner, t: decodeTokenTransfer(inner) }))
      .filter(
        ({ t }) => t && t.source === dist.channelTokenAccount && !excluded.has(t.destination),
      );
    if (transfers.length > 0) {
      for (const { inner, t } of transfers) {
        if (!t) continue;
        consumed.add(inner.path);
        pushPayout(inner.path, t.destination, t.amount);
      }
      for (const inner of parent?.inner ?? []) {
        if (TOKEN_PROGRAMS.has(inner.programId)) consumed.add(inner.path);
      }
      continue;
    }

    // Fallback (SPL Token batched CPIs, or distribute invoked via CPI): token balance
    // deltas. Only unambiguous with a single distribute in the transaction.
    if (distributes.length !== 1) {
      out.notes.push(
        `channel ${tx.signature}:${ix.path}: multiple distributes, payouts unattributed`,
      );
      continue;
    }
    for (const [account, info] of [...tx.tokenAccounts].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (excluded.has(account) || info.mint !== dist.mint) continue;
      const delta = info.post - info.pre;
      if (delta > 0n) pushPayout(`${ix.path}/${account}`, account, delta);
    }
    for (const inner of allInstructions(tx)) {
      if (
        TOKEN_PROGRAMS.has(inner.programId) &&
        inner.path.startsWith(`${ix.path.split(".")[0]}.`)
      ) {
        consumed.add(inner.path);
      }
    }
  }
}

// ── Direct transfers (MPP charge, plain agent-to-agent payments) ─────────────────────────

function classifyDirect(
  tx: NormalizedTx,
  ctx: ClassifyContext,
  blockTime: number,
  consumed: Set<string>,
  out: Classification,
): void {
  const tracked = ctx.trackedWallets;
  if (!tracked || tracked.size === 0) return;
  const facilitator = facilitatorLabel(tx.feePayer);

  for (const ix of allInstructions(tx)) {
    if (consumed.has(ix.path)) continue;
    const t = decodeTokenTransfer(ix);
    if (!t) continue;
    const src = tx.tokenAccounts.get(t.source);
    const dst = tx.tokenAccounts.get(t.destination);
    const payer = src?.owner ?? t.authority;
    const payee = dst?.owner;
    if (!payee || payer === payee) continue;
    if (!tracked.has(payer) && !tracked.has(payee)) continue;
    const mint = t.mint ?? src?.mint ?? dst?.mint;
    if (!mint) continue;
    const usd = toUsdMicros(ctx.cluster, mint, t.amount, ctx.extraStablecoins);
    if (usd === null) continue;
    consumed.add(ix.path);
    out.payments.push({
      id: `${tx.signature}:${ix.path}`,
      signature: tx.signature,
      slot: tx.slot,
      blockTime,
      rail: "direct_transfer",
      payer,
      payee,
      mint,
      amount: t.amount,
      usdMicros: usd,
      feePayer: tx.feePayer,
      ...(facilitator ? { facilitator } : {}),
    });
    if (tx.feePayer !== payer && !facilitator && !ctx.infrastructure?.has(tx.feePayer)) {
      out.links.push({ from: payer, to: tx.feePayer, kind: "fee_payer", evidence: tx.signature });
    }
  }
}

// ── Close-account rent destinations ─────────────────────────────────────────────────────

function collectCloseLinks(tx: NormalizedTx, ctx: ClassifyContext, out: Classification): void {
  const participants = new Set<Address>();
  for (const p of out.payments) {
    participants.add(p.payer);
    participants.add(p.payee);
  }
  for (const ix of allInstructions(tx)) {
    const close = decodeTokenClose(ix);
    if (!close || close.owner === close.destination) continue;
    if (ctx.infrastructure?.has(close.destination)) continue;
    const relevant =
      participants.has(close.owner) ||
      participants.has(close.destination) ||
      ctx.trackedWallets?.has(close.owner) ||
      ctx.trackedWallets?.has(close.destination);
    if (relevant) {
      out.links.push({
        from: close.owner,
        to: close.destination,
        kind: "close_destination",
        evidence: tx.signature,
      });
    }
  }
}
