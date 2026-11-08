import {
  type Address,
  address,
  fetchEncodedAccount,
  type GetAccountInfoApi,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Rpc,
} from "@solana/kit";
import { Reader, Writer } from "./borsh";
import {
  AGENT_SCORE_SIZE,
  AGENT_SCORE_VERSION,
  DISCRIMINATORS,
  SEEDS,
  TRUST_ORACLE_PROGRAM_ID,
} from "./constants";

/** Mirror of the program's `AgentScore` (see crates/trust-oracle-interface for offsets). */
export interface AgentScoreAccount {
  version: number;
  bump: number;
  registry: number;
  agent: Address;
  score: number;
  confidence: number;
  flags: number;
  washRatioBps: number;
  uniquePayers: number;
  organicVolume: bigint;
  rawVolume: bigint;
  epoch: bigint;
  updatedSlot: bigint;
  updatedAt: bigint;
  prevScore: number;
  methodologyVersion: number;
}

export function encodeAgentScore(a: AgentScoreAccount): Uint8Array {
  const w = new Writer()
    .bytes(DISCRIMINATORS.accounts.AgentScore)
    .u8(a.version)
    .u8(a.bump)
    .u8(a.registry)
    .pubkey(a.agent)
    .u16(a.score)
    .u16(a.confidence)
    .u32(a.flags)
    .u16(a.washRatioBps)
    .u32(a.uniquePayers)
    .u64(a.organicVolume)
    .u64(a.rawVolume)
    .u64(a.epoch)
    .u64(a.updatedSlot)
    .i64(a.updatedAt)
    .u16(a.prevScore)
    .u16(a.methodologyVersion)
    .zeros(27);
  const out = w.finish();
  if (out.length !== AGENT_SCORE_SIZE) throw new Error(`AgentScore size ${out.length}`);
  return out;
}

export function decodeAgentScore(data: Uint8Array): AgentScoreAccount {
  if (data.length < AGENT_SCORE_SIZE) throw new Error("AgentScore: wrong size");
  const r = new Reader(data);
  const disc = r.bytes(8);
  if (!disc.every((b, i) => b === DISCRIMINATORS.accounts.AgentScore[i])) {
    throw new Error("AgentScore: discriminator mismatch");
  }
  const version = r.u8();
  if (version === 0 || version > AGENT_SCORE_VERSION)
    throw new Error(`AgentScore: unsupported version ${version}`);
  return {
    version,
    bump: r.u8(),
    registry: r.u8(),
    agent: address(r.pubkey()),
    score: r.u16(),
    confidence: r.u16(),
    flags: r.u32(),
    washRatioBps: r.u16(),
    uniquePayers: r.u32(),
    organicVolume: r.u64(),
    rawVolume: r.u64(),
    epoch: r.u64(),
    updatedSlot: r.u64(),
    updatedAt: r.i64(),
    prevScore: r.u16(),
    methodologyVersion: r.u16(),
  };
}

export interface ScoreEpochAccount {
  version: number;
  bump: number;
  methodologyVersion: number;
  agentCount: number;
  epoch: bigint;
  merkleRoot: Uint8Array;
  methodologyHash: Uint8Array;
  inputsHash: Uint8Array;
  windowStart: bigint;
  windowEnd: bigint;
  publishedSlot: bigint;
  publishedAt: bigint;
  publisher: Address;
}

export function decodeScoreEpoch(data: Uint8Array): ScoreEpochAccount {
  const r = new Reader(data);
  const disc = r.bytes(8);
  if (!disc.every((b, i) => b === DISCRIMINATORS.accounts.ScoreEpoch[i])) {
    throw new Error("ScoreEpoch: discriminator mismatch");
  }
  return {
    version: r.u8(),
    bump: r.u8(),
    methodologyVersion: r.u16(),
    agentCount: r.u32(),
    epoch: r.u64(),
    merkleRoot: r.bytes(32),
    methodologyHash: r.bytes(32),
    inputsHash: r.bytes(32),
    windowStart: r.i64(),
    windowEnd: r.i64(),
    publishedSlot: r.u64(),
    publishedAt: r.i64(),
    publisher: address(r.pubkey()),
  };
}

export interface OracleConfigAccount {
  version: number;
  bump: number;
  paused: boolean;
  admin: Address;
  pendingAdmin: Address | null;
  publisher: Address;
  methodologyVersion: number;
  latestEpoch: bigint;
  latestEpochAt: bigint;
  scoreAccounts: bigint;
}

export function decodeOracleConfig(data: Uint8Array): OracleConfigAccount {
  const r = new Reader(data);
  const disc = r.bytes(8);
  if (!disc.every((b, i) => b === DISCRIMINATORS.accounts.OracleConfig[i])) {
    throw new Error("OracleConfig: discriminator mismatch");
  }
  const version = r.u8();
  const bump = r.u8();
  const paused = r.bool();
  const admin = address(r.pubkey());
  const pending = r.option(() => r.pubkey());
  return {
    version,
    bump,
    paused,
    admin,
    pendingAdmin: pending ? address(pending) : null,
    publisher: address(r.pubkey()),
    methodologyVersion: r.u16(),
    latestEpoch: r.u64(),
    latestEpochAt: r.i64(),
    scoreAccounts: r.u64(),
  };
}

// ── PDAs ────────────────────────────────────────────────────────────────────────────────

const addrEnc = getAddressEncoder();
const le64 = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};

export async function findConfigPda(programId: Address = TRUST_ORACLE_PROGRAM_ID) {
  return getProgramDerivedAddress({ programAddress: programId, seeds: [SEEDS.config] });
}

export async function findEpochPda(epoch: bigint, programId: Address = TRUST_ORACLE_PROGRAM_ID) {
  return getProgramDerivedAddress({ programAddress: programId, seeds: [SEEDS.epoch, le64(epoch)] });
}

export async function findAgentScorePda(
  agent: Address,
  programId: Address = TRUST_ORACLE_PROGRAM_ID,
) {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [SEEDS.score, addrEnc.encode(agent)],
  });
}

// ── Fetchers ────────────────────────────────────────────────────────────────────────────

/** Read an agent's materialised score straight from chain. Null if none was published. */
export async function fetchAgentScore(
  rpc: Rpc<GetAccountInfoApi>,
  agent: Address,
  programId: Address = TRUST_ORACLE_PROGRAM_ID,
): Promise<AgentScoreAccount | null> {
  const [pda] = await findAgentScorePda(agent, programId);
  const account = await fetchEncodedAccount(rpc, pda);
  if (!account.exists) return null;
  if (account.programAddress !== programId)
    throw new Error("AgentScore owned by unexpected program");
  return decodeAgentScore(new Uint8Array(account.data));
}

export async function fetchScoreEpoch(
  rpc: Rpc<GetAccountInfoApi>,
  epoch: bigint,
  programId: Address = TRUST_ORACLE_PROGRAM_ID,
): Promise<ScoreEpochAccount | null> {
  const [pda] = await findEpochPda(epoch, programId);
  const account = await fetchEncodedAccount(rpc, pda);
  return account.exists ? decodeScoreEpoch(new Uint8Array(account.data)) : null;
}

export async function fetchOracleConfig(
  rpc: Rpc<GetAccountInfoApi>,
  programId: Address = TRUST_ORACLE_PROGRAM_ID,
): Promise<OracleConfigAccount | null> {
  const [pda] = await findConfigPda(programId);
  const account = await fetchEncodedAccount(rpc, pda);
  return account.exists ? decodeOracleConfig(new Uint8Array(account.data)) : null;
}
