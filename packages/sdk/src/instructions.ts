import {
  type AccountMeta,
  AccountRole,
  type AccountSignerMeta,
  type Address,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { findAgentScorePda, findConfigPda, findEpochPda } from "./accounts";
import { Writer } from "./borsh";
import { DISCRIMINATORS, TRUST_ORACLE_PROGRAM_ID } from "./constants";
import type { TrustPolicy } from "./policy";

/**
 * Hand-written instruction builders matching the Anchor program's borsh args.
 * After `anchor build` you can switch to the Codama-generated client; these builders and the
 * parity tests pin the wire format either way.
 */

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const BPF_LOADER_UPGRADEABLE = address("BPFLoaderUpgradeab1e11111111111111111111111");

type Meta = AccountMeta | AccountSignerMeta;
const ro = (a: Address): Meta => ({ address: a, role: AccountRole.READONLY });
const rw = (a: Address): Meta => ({ address: a, role: AccountRole.WRITABLE });
const signer = (s: TransactionSigner, writable: boolean): AccountSignerMeta => ({
  address: s.address,
  role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
  signer: s,
});

function ix(programAddress: Address, accounts: Meta[], data: Uint8Array): Instruction {
  return { programAddress, accounts, data };
}

export interface ProgramOpts {
  programId?: Address;
}

export async function getInitializeInstruction(
  input: { admin: TransactionSigner; publisher: Address; methodologyVersion: number } & ProgramOpts,
): Promise<Instruction> {
  const programId = input.programId ?? TRUST_ORACLE_PROGRAM_ID;
  const [config] = await findConfigPda(programId);
  const [programData] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE,
    seeds: [getAddressEncoder().encode(programId)],
  });
  const data = new Writer()
    .bytes(DISCRIMINATORS.instructions.initialize)
    .pubkey(input.publisher)
    .u16(input.methodologyVersion)
    .finish();
  return ix(
    programId,
    [signer(input.admin, true), rw(config), ro(programId), ro(programData), ro(SYSTEM_PROGRAM)],
    data,
  );
}

export async function getUpdateConfigInstruction(
  input: {
    admin: TransactionSigner;
    publisher?: Address;
    paused?: boolean;
    methodologyVersion?: number;
  } & ProgramOpts,
): Promise<Instruction> {
  const programId = input.programId ?? TRUST_ORACLE_PROGRAM_ID;
  const [config] = await findConfigPda(programId);
  const w = new Writer().bytes(DISCRIMINATORS.instructions.update_config);
  w.option(input.publisher, (p) => w.pubkey(p));
  w.option(input.paused, (p) => w.bool(p));
  w.option(input.methodologyVersion, (v) => w.u16(v));
  return ix(programId, [signer(input.admin, false), rw(config)], w.finish());
}

export interface PublishEpochArgs {
  epoch: bigint;
  merkleRoot: Uint8Array;
  methodologyHash: Uint8Array;
  inputsHash: Uint8Array;
  windowStart: bigint;
  windowEnd: bigint;
  agentCount: number;
  methodologyVersion: number;
}

export function encodePublishEpochArgs(a: PublishEpochArgs): Uint8Array {
  for (const [name, b] of [
    ["merkleRoot", a.merkleRoot],
    ["methodologyHash", a.methodologyHash],
    ["inputsHash", a.inputsHash],
  ] as const) {
    if (b.length !== 32) throw new Error(`${name} must be 32 bytes`);
  }
  return new Writer()
    .bytes(DISCRIMINATORS.instructions.publish_epoch)
    .u64(a.epoch)
    .bytes(a.merkleRoot)
    .bytes(a.methodologyHash)
    .bytes(a.inputsHash)
    .i64(a.windowStart)
    .i64(a.windowEnd)
    .u32(a.agentCount)
    .u16(a.methodologyVersion)
    .finish();
}

export async function getPublishEpochInstruction(
  input: { publisher: TransactionSigner; args: PublishEpochArgs } & ProgramOpts,
): Promise<Instruction> {
  const programId = input.programId ?? TRUST_ORACLE_PROGRAM_ID;
  const [config] = await findConfigPda(programId);
  const [epoch] = await findEpochPda(input.args.epoch, programId);
  return ix(
    programId,
    [signer(input.publisher, true), rw(config), rw(epoch), ro(SYSTEM_PROGRAM)],
    encodePublishEpochArgs(input.args),
  );
}

export interface UpsertScoreArgs {
  agent: Address;
  registry: number;
  score: number;
  confidence: number;
  flags: number;
  washRatioBps: number;
  uniquePayers: number;
  organicVolume: bigint;
  rawVolume: bigint;
}

export function encodeUpsertScoreArgs(a: UpsertScoreArgs): Uint8Array {
  return new Writer()
    .bytes(DISCRIMINATORS.instructions.upsert_score)
    .pubkey(a.agent)
    .u8(a.registry)
    .u16(a.score)
    .u16(a.confidence)
    .u32(a.flags)
    .u16(a.washRatioBps)
    .u32(a.uniquePayers)
    .u64(a.organicVolume)
    .u64(a.rawVolume)
    .finish();
}

/** `latestEpoch` must be the epoch currently recorded in the config account. */
export async function getUpsertScoreInstruction(
  input: { publisher: TransactionSigner; latestEpoch: bigint; args: UpsertScoreArgs } & ProgramOpts,
): Promise<Instruction> {
  const programId = input.programId ?? TRUST_ORACLE_PROGRAM_ID;
  const [config] = await findConfigPda(programId);
  const [epoch] = await findEpochPda(input.latestEpoch, programId);
  const [agentScore] = await findAgentScorePda(input.args.agent, programId);
  return ix(
    programId,
    [signer(input.publisher, true), rw(config), ro(epoch), rw(agentScore), ro(SYSTEM_PROGRAM)],
    encodeUpsertScoreArgs(input.args),
  );
}

export async function getAssertTrustInstruction(
  input: { agent: Address; policy: TrustPolicy } & ProgramOpts,
): Promise<Instruction> {
  const programId = input.programId ?? TRUST_ORACLE_PROGRAM_ID;
  const [agentScore] = await findAgentScorePda(input.agent, programId);
  const data = new Writer()
    .bytes(DISCRIMINATORS.instructions.assert_trust)
    .u16(input.policy.minScore)
    .u16(input.policy.minConfidence)
    .u64(input.policy.maxAgeSlots)
    .u32(input.policy.forbiddenFlags)
    .finish();
  return ix(programId, [ro(agentScore)], data);
}

export interface ScoreLeafArgs {
  agent: Address;
  registry: number;
  epoch: bigint;
  score: number;
  confidence: number;
  flags: number;
  washRatioBps: number;
  uniquePayers: number;
  organicVolume: bigint;
}

export async function getVerifyScoreProofInstruction(
  input: { leaf: ScoreLeafArgs; proof: Uint8Array[] } & ProgramOpts,
): Promise<Instruction> {
  const programId = input.programId ?? TRUST_ORACLE_PROGRAM_ID;
  const [epoch] = await findEpochPda(input.leaf.epoch, programId);
  const w = new Writer()
    .bytes(DISCRIMINATORS.instructions.verify_score_proof)
    .pubkey(input.leaf.agent)
    .u8(input.leaf.registry)
    .u64(input.leaf.epoch)
    .u16(input.leaf.score)
    .u16(input.leaf.confidence)
    .u32(input.leaf.flags)
    .u16(input.leaf.washRatioBps)
    .u32(input.leaf.uniquePayers)
    .u64(input.leaf.organicVolume)
    .u32(input.proof.length);
  for (const p of input.proof) {
    if (p.length !== 32) throw new Error("proof nodes must be 32 bytes");
    w.bytes(p);
  }
  return ix(programId, [ro(epoch)], w.finish());
}
