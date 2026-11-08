/**
 * Score flags, a u32 bitmask. MUST stay in sync with
 * `crates/trust-oracle-interface/src/lib.rs::flags` (checked by the fixture parity tests).
 *
 * Flags fall into two classes:
 *  - **Penalising** (SELF_DEALING, CIRCULAR_FLOW): only flows the agent took part in can set
 *    them, so a third party cannot set them on a victim.
 *  - **Informational** (everything else): context for consumers. They never lower the score.
 */
export const Flag = {
  /** ≥ threshold of the agent's flow is to or from wallets it controls. */
  SELF_DEALING: 1 << 0,
  /** ≥ threshold of the agent's flow sits in tight cycles (wash rings). */
  CIRCULAR_FLOW: 1 << 1,
  /** Many distinct payer wallets collapse into few entities (sybil payers). */
  FUNDING_CLUSTER: 1 << 2,
  /** A single payer entity dominates credited inflow. */
  CONCENTRATED_PAYERS: 1 << 3,
  /** Most inflow comes from fresh, single-purpose payer wallets. */
  FRESH_PAYERS: 1 << 4,
  /** Credited inflow over the last 24h is far above the trailing baseline. */
  BURST: 1 << 5,
  /** Too few credible payers or active days for a confident score. */
  INSUFFICIENT_DATA: 1 << 6,
  /** Scored from a raw payee wallet; no registry identity. */
  UNREGISTERED: 1 << 7,
  /** Set by oracle governance after manual review. */
  MANUAL_REVIEW: 1 << 8,
} as const;

export type FlagName = keyof typeof Flag;

export const PENALISING_FLAGS = Flag.SELF_DEALING | Flag.CIRCULAR_FLOW;

export function hasFlag(mask: number, flag: number): boolean {
  return (mask & flag) === flag;
}

export function describeFlags(mask: number): FlagName[] {
  return (Object.keys(Flag) as FlagName[]).filter((name) => hasFlag(mask, Flag[name]));
}
