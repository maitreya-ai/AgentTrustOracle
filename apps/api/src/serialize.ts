import { describeFlags, REGISTRY_CODE } from "@ato/core";
import { tierOf } from "@ato/sdk";
import type { StoredScore } from "./store";

const usd = (micros: bigint) => Number(micros) / 1_000_000;

export function scoreBody(s: StoredScore, methodologyVersion: number) {
  return {
    agent: s.agentId,
    registry: s.registry,
    epoch: s.epoch.toString(),
    score: s.score,
    confidence: s.confidence,
    flags: s.flags,
    flagNames: describeFlags(s.flags),
    washRatioBps: s.washRatioBps,
    uniquePayers: s.uniquePayers,
    organicVolumeUsd: usd(s.organicVolumeMicros),
    rawVolumeUsd: usd(s.rawVolumeMicros),
    tier: tierOf(s.score, s.confidence),
    methodologyVersion,
  };
}

export function reportBody(s: StoredScore, methodologyVersion: number) {
  const evidence = s.evidence as {
    linkedWallets: string[];
    mergeLinks: unknown[];
    cycles: { path: string[]; amount: string; intensity: number; wash: boolean }[];
  };
  return {
    ...scoreBody(s, methodologyVersion),
    components: s.components,
    features: s.features,
    evidence: {
      linkedWallets: evidence.linkedWallets,
      mergeLinks: evidence.mergeLinks,
      cycles: evidence.cycles.map((c) => ({
        path: c.path,
        amountUsd: Number(c.amount) / 1_000_000,
        intensity: c.intensity,
        wash: c.wash,
      })),
    },
  };
}

export function proofBody(s: StoredScore, merkleRoot: string) {
  return {
    agent: s.agentId,
    epoch: s.epoch.toString(),
    merkleRoot,
    leaf: {
      agent: s.agentId,
      registry: REGISTRY_CODE[s.registry],
      epoch: s.epoch.toString(),
      score: s.score,
      confidence: s.confidence,
      flags: s.flags,
      washRatioBps: s.washRatioBps,
      uniquePayers: s.uniquePayers,
      organicVolume: s.organicVolumeMicros.toString(),
    },
    proof: s.proof,
  };
}
