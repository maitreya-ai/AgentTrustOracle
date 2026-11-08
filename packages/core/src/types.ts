/**
 * Base58-encoded Solana address. Core stays chain-agnostic and dependency-light,
 * so this is a plain string; `@solana/kit`'s branded `Address` is assignable to it.
 */
export type Address = string;

/** How a payment settled onchain. */
export type PaymentRail =
  /** x402 `exact` scheme: facilitator-sponsored TransferChecked + memo. */
  | "x402_exact"
  /** Solana payment-channels program payout (x402 `upto`, MPP `session`). */
  | "payment_channel"
  /** Any other stablecoin transfer touching a tracked agent wallet (e.g. MPP `charge`). */
  | "direct_transfer";

export interface Payment {
  /** Globally unique: `${signature}:${instructionPath}`. */
  id: string;
  signature: string;
  slot: number;
  /** Unix seconds. */
  blockTime: number;
  rail: PaymentRail;
  /** Economic payer: a wallet, never a token account or channel escrow PDA. */
  payer: Address;
  /** Economic payee: owner of the destination token account. */
  payee: Address;
  mint: Address;
  /** Raw token amount in base units. */
  amount: bigint;
  /** Value normalised to micro-USD (1e-6 USD). v1 only counts stablecoins. */
  usdMicros: bigint;
  feePayer?: Address;
  /** Known facilitator label when the fee payer is a registered x402 facilitator. */
  facilitator?: string;
}

/**
 * Evidence that two wallets are controlled by the same entity.
 * Links are undirected for clustering; `from`/`to` only preserve provenance.
 */
export type LinkKind =
  /** Wallet is the owner of a registry agent identity. */
  | "registry_owner"
  /** Wallet is the signature-verified operational wallet of an agent. */
  | "registry_agent_wallet"
  /** Wallet registered (created) the agent identity. Platforms create many: soft. */
  | "registry_creator"
  /** Agent declares a parent agent identity. */
  | "registry_parent"
  /** `to` sent the first lamports that created `from`. */
  | "funded_by"
  /** `to` paid transaction fees for a tx authorised by `from` (non-facilitator). */
  | "fee_payer"
  /** `to` funded payment-channel rent for payer `from`. */
  | "channel_rent_payer"
  /** Closing a token account owned by `from` sent its rent to `to`. */
  | "close_destination";

export interface WalletLink {
  from: Address;
  to: Address;
  kind: LinkKind;
  /** Signature or other pointer that justifies the link. */
  evidence?: string;
}

export interface WalletProfile {
  address: Address;
  /** Unix seconds of the wallet's first onchain activity, if resolved. */
  firstSeenAt?: number;
  /** Sender of the wallet's first lamports, if resolved. */
  firstFunder?: Address;
}

export type RegistryKind = "8004" | "sati" | "wallet";

export interface AgentIdentity {
  /** Registry identity key (8004 Core asset, SATI mint) or the wallet itself for `wallet`. */
  id: Address;
  registry: RegistryKind;
  /** Wallets that send and receive payments for this agent (verified links only). */
  wallets: Address[];
  owner?: Address;
  creator?: Address;
  /** Parent agent identity id. */
  parent?: Address;
}

/** Numeric encoding of {@link RegistryKind} used onchain and in Merkle leaves. */
export const REGISTRY_CODE: Record<RegistryKind, number> = {
  "8004": 0,
  sati: 1,
  wallet: 2,
};
