import { Flag, PENALISING_FLAGS } from "@ato/core";
import type { AgentScoreAccount } from "./accounts";

/**
 * Same semantics as `trust_oracle_interface::TrustPolicy`, so offchain checks (agents
 * deciding whom to pay) and onchain checks (programs gating actions) agree exactly.
 */
export interface TrustPolicy {
  minScore: number;
  /** basis points */
  minConfidence: number;
  /** 0 disables the staleness check. */
  maxAgeSlots: bigint;
  forbiddenFlags: number;
}

export type PolicyViolation = "ForbiddenFlags" | "ScoreTooLow" | "ConfidenceTooLow" | "Stale";

const TWO_DAYS_SLOTS = 432_000n;

export const POLICIES = {
  STANDARD: {
    minScore: 600,
    minConfidence: 5_000,
    maxAgeSlots: TWO_DAYS_SLOTS,
    forbiddenFlags: PENALISING_FLAGS,
  },
  STRICT: {
    minScore: 800,
    minConfidence: 8_000,
    maxAgeSlots: TWO_DAYS_SLOTS,
    forbiddenFlags: PENALISING_FLAGS | Flag.FUNDING_CLUSTER | Flag.MANUAL_REVIEW,
  },
} as const satisfies Record<string, TrustPolicy>;

type ScoreLike = Pick<AgentScoreAccount, "score" | "confidence" | "flags" | "updatedSlot">;

/** Returns null when the policy is satisfied, otherwise the first violation (same order as Rust). */
export function checkTrust(
  s: ScoreLike,
  policy: TrustPolicy,
  currentSlot: bigint,
): PolicyViolation | null {
  if ((s.flags & policy.forbiddenFlags) !== 0) return "ForbiddenFlags";
  if (s.score < policy.minScore) return "ScoreTooLow";
  if (s.confidence < policy.minConfidence) return "ConfidenceTooLow";
  if (policy.maxAgeSlots > 0n) {
    const age = currentSlot > s.updatedSlot ? currentSlot - s.updatedSlot : 0n;
    if (age > policy.maxAgeSlots) return "Stale";
  }
  return null;
}

export type Tier = "platinum" | "gold" | "silver" | "bronze" | "unrated";

/** Coarse tier for badges and UIs. Gate on {@link checkTrust}, not on tiers. */
export function tierOf(score: number, confidence: number): Tier {
  if (confidence < 3_000) return "unrated";
  if (score >= 800) return "platinum";
  if (score >= 600) return "gold";
  if (score >= 400) return "silver";
  return "bronze";
}
