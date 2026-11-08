import type { Address } from "@ato/core";

/** Well-known program ids. Sources: x402 exact-SVM spec, payment-channels README, 8004-solana README. */
export const PROGRAMS = {
  system: "11111111111111111111111111111111",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  splToken: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  memoV1: "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
  memoV2: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  ed25519: "Ed25519SigVerify111111111111111111111111111",
  /** Lighthouse assertion program, allowed as a guard by the x402 exact-SVM spec. */
  lighthouse: "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
  /** Solana Foundation payment channels (x402 `upto`, MPP `session`). Live on mainnet. */
  paymentChannels: "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX",
} as const satisfies Record<string, Address>;

/** ERC-8004 Agent Registry by Quantu Labs (backs solana.com/agent-registry). */
export const AGENT_REGISTRY_8004 = {
  "mainnet-beta": "8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ",
  devnet: "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C",
} as const;

/** SATI (Cascade): Token-2022 agent identities + compressed attestations. */
export const SATI_PROGRAM = "satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe";

export const TOKEN_PROGRAMS: ReadonlySet<string> = new Set([PROGRAMS.splToken, PROGRAMS.token2022]);
export const MEMO_PROGRAMS: ReadonlySet<string> = new Set([PROGRAMS.memoV1, PROGRAMS.memoV2]);

export type Cluster = "mainnet-beta" | "devnet" | "localnet";

/** Stablecoins counted in v1. Value = 1 USD per whole token. */
export interface Stablecoin {
  symbol: string;
  decimals: number;
  /** Owning token program (PYUSD is Token-2022). */
  tokenProgram: Address;
}

export const STABLECOINS: Record<Cluster, Record<Address, Stablecoin>> = {
  "mainnet-beta": {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
      symbol: "USDC",
      decimals: 6,
      tokenProgram: PROGRAMS.splToken,
    },
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
      symbol: "USDT",
      decimals: 6,
      tokenProgram: PROGRAMS.splToken,
    },
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": {
      symbol: "PYUSD",
      decimals: 6,
      tokenProgram: PROGRAMS.token2022,
    },
  },
  devnet: {
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": {
      symbol: "USDC",
      decimals: 6,
      tokenProgram: PROGRAMS.splToken,
    },
  },
  localnet: {},
};

/** Convert a raw token amount to micro-USD. Returns null for non-stablecoins. */
export function toUsdMicros(
  cluster: Cluster,
  mint: Address,
  amount: bigint,
  extra: Record<Address, Stablecoin> = {},
): bigint | null {
  const coin = extra[mint] ?? STABLECOINS[cluster][mint];
  if (!coin) return null;
  const shift = coin.decimals - 6;
  if (shift === 0) return amount;
  return shift > 0 ? amount / 10n ** BigInt(shift) : amount * 10n ** BigInt(-shift);
}
