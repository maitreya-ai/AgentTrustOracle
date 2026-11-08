import { type AgentIdentity, encodeAddress, sha256 } from "@ato/core";
import {
  address,
  type Base58EncodedBytes,
  type GetProgramAccountsApi,
  getBase64Encoder,
  type Rpc,
} from "@solana/kit";
import { bytesToBase58 } from "../normalize";
import { AGENT_REGISTRY_8004 } from "../programs";
import type { IdentityProvider } from "./types";

/**
 * Decoder for `AgentAccount` in QuantuLabs/8004-solana (programs/agent-registry-8004/src/
 * identity/state.rs), PDA seeds ["agent", asset]. Fixed-size fields come first. Layout:
 *
 *   disc[8] collection[32] creator[32] owner[32] asset[32] bump u8 atom_enabled bool
 *   agent_wallet Option<Pubkey> feedback_digest[32] feedback_count u64
 *   response_digest[32] response_count u64 revoke_digest[32] revoke_count u64
 *   parent_asset Option<Pubkey> parent_locked bool col_locked bool
 *   agent_uri String nft_name String col String
 *
 * Re-check this against the deployed program before trusting it on mainnet: the README
 * pins the mainnet binary hash as of 2026-03-04 and the layout can change on upgrade.
 */
export interface Erc8004AgentAccount {
  collection: string;
  creator: string;
  owner: string;
  asset: string;
  atomEnabled: boolean;
  agentWallet: string | null;
  feedbackCount: bigint;
  parentAsset: string | null;
  agentUri: string;
  nftName: string;
}

export const AGENT_ACCOUNT_DISCRIMINATOR = sha256(
  new TextEncoder().encode("account:AgentAccount"),
).slice(0, 8);

export function decodeErc8004Agent(data: Uint8Array): Erc8004AgentAccount {
  const r = new Reader(data);
  const disc = r.bytes(8);
  if (!disc.every((b, i) => b === AGENT_ACCOUNT_DISCRIMINATOR[i])) {
    throw new Error("not an 8004 AgentAccount (discriminator mismatch)");
  }
  const collection = r.pubkey();
  const creator = r.pubkey();
  const owner = r.pubkey();
  const asset = r.pubkey();
  r.u8(); // bump
  const atomEnabled = r.u8() === 1;
  const agentWallet = r.optionPubkey();
  r.bytes(32);
  const feedbackCount = r.u64();
  r.bytes(32);
  r.u64();
  r.bytes(32);
  r.u64();
  const parentAsset = r.optionPubkey();
  r.u8();
  r.u8();
  const agentUri = r.string();
  const nftName = r.string();
  return {
    collection,
    creator,
    owner,
    asset,
    atomEnabled,
    agentWallet,
    feedbackCount,
    parentAsset,
    agentUri,
    nftName,
  };
}

/** Map a registry record to the scorer's identity model. */
export function toAgentIdentity(a: Erc8004AgentAccount): AgentIdentity {
  return {
    id: a.asset,
    registry: "8004",
    // The signature-verified operational wallet is primary. Fall back to the NFT owner only
    // when none is set, so a cold owner wallet's unrelated activity is not attributed.
    wallets: a.agentWallet ? [a.agentWallet] : [a.owner],
    owner: a.owner,
    creator: a.creator,
    ...(a.parentAsset ? { parent: a.parentAsset } : {}),
  };
}

export class Erc8004Provider implements IdentityProvider {
  readonly registry = "8004" as const;

  constructor(
    private readonly rpc: Rpc<GetProgramAccountsApi>,
    private readonly programId: string = AGENT_REGISTRY_8004["mainnet-beta"],
  ) {}

  async *listAgents(): AsyncIterable<AgentIdentity> {
    const accounts = await this.rpc
      .getProgramAccounts(address(this.programId), {
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: 0n,
              bytes: bytesToBase58(AGENT_ACCOUNT_DISCRIMINATOR) as Base58EncodedBytes,
              encoding: "base58",
            },
          },
        ],
      })
      .send();
    const b64 = getBase64Encoder();
    for (const { account } of accounts) {
      try {
        const data = new Uint8Array(b64.encode(account.data[0]));
        yield toAgentIdentity(decodeErc8004Agent(data));
      } catch {
        // Skip accounts that fail to decode (layout drift); surfaced by the sync job's counts.
      }
    }
  }
}

class Reader {
  private o = 0;
  private view: DataView;
  constructor(private readonly d: Uint8Array) {
    this.view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  }
  bytes(n: number): Uint8Array {
    if (this.o + n > this.d.length) throw new Error("account data truncated");
    const out = this.d.slice(this.o, this.o + n);
    this.o += n;
    return out;
  }
  u8(): number {
    return this.bytes(1)[0] as number;
  }
  u32(): number {
    const v = this.view.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  u64(): bigint {
    const v = this.view.getBigUint64(this.o, true);
    this.o += 8;
    return v;
  }
  pubkey(): string {
    return encodeAddress(this.bytes(32));
  }
  optionPubkey(): string | null {
    return this.u8() === 1 ? this.pubkey() : null;
  }
  string(): string {
    const len = this.u32();
    return new TextDecoder().decode(this.bytes(len));
  }
}
