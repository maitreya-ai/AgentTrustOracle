import type { Address } from "@ato/core";
import { getBase58Decoder, getBase58Encoder } from "@solana/kit";

/**
 * One transaction shape for every source (RPC `getTransaction`, Yellowstone/LaserStream gRPC,
 * fixtures). Classifiers only ever see this, so they are pure and unit-testable.
 */
export interface NormalizedInstruction {
  programId: Address;
  accounts: Address[];
  data: Uint8Array;
  /** "3" for top-level instruction 3, "3.1" for its second inner instruction. */
  path: string;
  /** Inner (CPI) instructions, flattened in execution order. Empty for inner ixs. */
  inner: NormalizedInstruction[];
}

export interface TokenAccountInfo {
  owner?: Address;
  mint: Address;
  decimals: number;
  programId?: Address;
  pre: bigint;
  post: bigint;
}

export interface NormalizedTx {
  signature: string;
  slot: number;
  /** Unix seconds; null when the source does not provide it (e.g. raw gRPC tx updates). */
  blockTime: number | null;
  failed: boolean;
  feePayer: Address;
  signers: Address[];
  accountKeys: Address[];
  instructions: NormalizedInstruction[];
  /** Token accounts touched by the tx, keyed by token-account address. */
  tokenAccounts: Map<Address, TokenAccountInfo>;
}

const b58enc = getBase58Encoder();
const b58dec = getBase58Decoder();

export const base58ToBytes = (s: string): Uint8Array => new Uint8Array(b58enc.encode(s));
export const bytesToBase58 = (b: Uint8Array): string => b58dec.decode(b);

// ── RPC `getTransaction(sig, { encoding: "json", maxSupportedTransactionVersion: 0 })` ──────

type Num = number | bigint;

interface RpcCompiledInstruction {
  programIdIndex: Num;
  accounts: readonly Num[];
  data: string;
  stackHeight?: Num | null;
}

interface RpcTokenBalance {
  accountIndex: Num;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: Num };
}

export interface RpcJsonTransaction {
  slot: Num;
  blockTime?: Num | null;
  meta: {
    err: unknown;
    innerInstructions?:
      | readonly { index: Num; instructions: readonly RpcCompiledInstruction[] }[]
      | null;
    loadedAddresses?: { writable: readonly string[]; readonly: readonly string[] } | null;
    preTokenBalances?: readonly RpcTokenBalance[] | null;
    postTokenBalances?: readonly RpcTokenBalance[] | null;
  } | null;
  transaction: {
    signatures: readonly string[];
    message: {
      accountKeys: readonly string[];
      header: { numRequiredSignatures: Num };
      instructions: readonly RpcCompiledInstruction[];
    };
  };
}

export function fromRpcJson(tx: RpcJsonTransaction): NormalizedTx {
  const msg = tx.transaction.message;
  const keys: Address[] = [
    ...msg.accountKeys,
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ];
  const key = (i: Num) => {
    const k = keys[Number(i)];
    if (k === undefined) throw new Error(`account index ${i} out of range`);
    return k;
  };
  const compile = (ix: RpcCompiledInstruction, path: string): NormalizedInstruction => ({
    programId: key(ix.programIdIndex),
    accounts: ix.accounts.map(key),
    data: base58ToBytes(ix.data),
    path,
    inner: [],
  });

  const instructions = msg.instructions.map((ix, i) => compile(ix, String(i)));
  for (const group of tx.meta?.innerInstructions ?? []) {
    const parent = instructions[Number(group.index)];
    if (!parent) continue;
    group.instructions.forEach((ix, j) => {
      parent.inner.push(compile(ix, `${group.index}.${j}`));
    });
  }

  const tokenAccounts = new Map<Address, TokenAccountInfo>();
  const apply = (balances: readonly RpcTokenBalance[] | null | undefined, side: "pre" | "post") => {
    for (const b of balances ?? []) {
      const address = key(b.accountIndex);
      const cur = tokenAccounts.get(address) ?? {
        mint: b.mint,
        decimals: Number(b.uiTokenAmount.decimals),
        pre: 0n,
        post: 0n,
        ...(b.owner ? { owner: b.owner } : {}),
        ...(b.programId ? { programId: b.programId } : {}),
      };
      cur[side] = BigInt(b.uiTokenAmount.amount);
      if (!cur.owner && b.owner) cur.owner = b.owner;
      tokenAccounts.set(address, cur);
    }
  };
  apply(tx.meta?.preTokenBalances, "pre");
  apply(tx.meta?.postTokenBalances, "post");

  const numSigners = Number(msg.header.numRequiredSignatures);
  return {
    signature: tx.transaction.signatures[0] ?? "",
    slot: Number(tx.slot),
    blockTime: tx.blockTime === null || tx.blockTime === undefined ? null : Number(tx.blockTime),
    failed: tx.meta?.err !== null && tx.meta?.err !== undefined,
    feePayer: keys[0] ?? "",
    signers: keys.slice(0, numSigners),
    accountKeys: keys,
    instructions,
    tokenAccounts,
  };
}

// ── Yellowstone gRPC / Helius LaserStream `SubscribeUpdateTransaction` ───────────────────

interface GeyserCompiledInstruction {
  programIdIndex: number;
  accounts: Uint8Array;
  data: Uint8Array;
}

interface GeyserTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount?: { amount: string; decimals: number };
}

/**
 * Subset of the Yellowstone protobuf `SubscribeUpdateTransaction` we rely on. Field names
 * follow the generated JS bindings (camelCase); validate against your client version.
 */
export interface GeyserTransactionUpdate {
  slot: Num | string;
  transaction?: {
    signature: Uint8Array;
    transaction?: {
      message?: {
        header?: { numRequiredSignatures: number };
        accountKeys: Uint8Array[];
        instructions: GeyserCompiledInstruction[];
      };
    };
    meta?: {
      err?: unknown;
      innerInstructions?: { index: number; instructions: GeyserCompiledInstruction[] }[];
      preTokenBalances?: GeyserTokenBalance[];
      postTokenBalances?: GeyserTokenBalance[];
      loadedWritableAddresses?: Uint8Array[];
      loadedReadonlyAddresses?: Uint8Array[];
    };
  };
}

export function fromGeyser(
  update: GeyserTransactionUpdate,
  blockTime: number | null = null,
): NormalizedTx {
  const t = update.transaction;
  const msg = t?.transaction?.message;
  if (!t || !msg) throw new Error("geyser update has no transaction message");
  const meta = t.meta;
  const toJsonIx = (ix: GeyserCompiledInstruction): RpcCompiledInstruction => ({
    programIdIndex: ix.programIdIndex,
    accounts: [...ix.accounts],
    data: bytesToBase58(ix.data),
  });
  const toJsonBal = (b: GeyserTokenBalance): RpcTokenBalance => ({
    accountIndex: b.accountIndex,
    mint: b.mint,
    ...(b.owner ? { owner: b.owner } : {}),
    ...(b.programId ? { programId: b.programId } : {}),
    uiTokenAmount: {
      amount: b.uiTokenAmount?.amount ?? "0",
      decimals: b.uiTokenAmount?.decimals ?? 0,
    },
  });
  return fromRpcJson({
    slot: typeof update.slot === "string" ? BigInt(update.slot) : update.slot,
    blockTime,
    meta: {
      err: meta?.err ?? null,
      innerInstructions: (meta?.innerInstructions ?? []).map((g) => ({
        index: g.index,
        instructions: g.instructions.map(toJsonIx),
      })),
      loadedAddresses: {
        writable: (meta?.loadedWritableAddresses ?? []).map(bytesToBase58),
        readonly: (meta?.loadedReadonlyAddresses ?? []).map(bytesToBase58),
      },
      preTokenBalances: (meta?.preTokenBalances ?? []).map(toJsonBal),
      postTokenBalances: (meta?.postTokenBalances ?? []).map(toJsonBal),
    },
    transaction: {
      signatures: [bytesToBase58(t.signature)],
      message: {
        accountKeys: msg.accountKeys.map(bytesToBase58),
        header: { numRequiredSignatures: msg.header?.numRequiredSignatures ?? 1 },
        instructions: msg.instructions.map(toJsonIx),
      },
    },
  });
}

/** Every instruction (top-level and inner) in execution order. */
export function allInstructions(tx: NormalizedTx): NormalizedInstruction[] {
  const out: NormalizedInstruction[] = [];
  for (const ix of tx.instructions) {
    out.push(ix);
    out.push(...ix.inner);
  }
  return out;
}
