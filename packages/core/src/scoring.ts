import type { CycleEvidence } from "./cycles";
import type { EntityId } from "./entities";
import { Flag } from "./flags";
import type { Methodology } from "./methodology";
import type { Address, RegistryKind, WalletLink } from "./types";

export interface ScoreComponents {
  trust: number;
  volume: number;
  payers: number;
  repeat: number;
  longevity: number;
}

export interface ScoreFeatures {
  rawInflowMicros: bigint;
  rawOutflowMicros: bigint;
  /** Inflow net of self-dealing and all circulation. */
  organicInflowMicros: bigint;
  /** Organic inflow weighted by each payer's credibility. Drives the score. */
  creditedInflowMicros: bigint;
  selfDealingMicros: bigint;
  washCircularMicros: bigint;
  incidentalCircularMicros: bigint;
  uniquePayerWallets: number;
  uniquePayerEntities: number;
  effectivePayers: number;
  repeatPayers: number;
  activeDays: number;
  trustLift: number;
  penalisedRatio: number;
  topPayerShare: number;
  freshExclusiveShare: number;
  last24hCreditedMicros: bigint;
}

export interface AgentScore {
  agent: Address;
  registry: RegistryKind;
  entity: EntityId;
  /** 0..=1000 */
  score: number;
  /** basis points 0..=10000 */
  confidence: number;
  flags: number;
  /** Penalised (self-dealing + wash ring) share of total flow, in bps. */
  washRatioBps: number;
  /** Distinct payer *entities* (sybil-collapsed). */
  uniquePayers: number;
  organicVolumeMicros: bigint;
  rawVolumeMicros: bigint;
  components: ScoreComponents;
  features: ScoreFeatures;
  evidence: {
    linkedWallets: Address[];
    mergeLinks: WalletLink[];
    cycles: CycleEvidence[];
  };
}

/** Accumulated per-agent observations, filled by the epoch pipeline. */
export interface AgentAccumulator {
  rawIn: bigint;
  rawOut: bigint;
  organicIn: bigint;
  creditedIn: bigint;
  selfDealing: bigint;
  wash: bigint;
  incidental: bigint;
  payerWallets: Set<Address>;
  /** Raw non-self inflow per payer entity. */
  rawByPayer: Map<EntityId, bigint>;
  creditedByPayer: Map<EntityId, bigint>;
  daysByPayer: Map<EntityId, Set<number>>;
  firstPaymentByPayer: Map<EntityId, number>;
  creditedDays: Set<number>;
  last24hCredited: bigint;
  creditedByDay: Map<number, bigint>;
}

export function newAccumulator(): AgentAccumulator {
  return {
    rawIn: 0n,
    rawOut: 0n,
    organicIn: 0n,
    creditedIn: 0n,
    selfDealing: 0n,
    wash: 0n,
    incidental: 0n,
    payerWallets: new Set(),
    rawByPayer: new Map(),
    creditedByPayer: new Map(),
    daysByPayer: new Map(),
    firstPaymentByPayer: new Map(),
    creditedDays: new Set(),
    last24hCredited: 0n,
    creditedByDay: new Map(),
  };
}

export interface ScoringContext {
  methodology: Methodology;
  asOf: number;
  trustLift: number;
  /** Entity id → first-seen unix seconds. */
  firstSeen: (entity: EntityId) => number | undefined;
  /** Entity id → number of distinct payee entities it paid in the window. */
  payeeDegree: (entity: EntityId) => number;
}

const DAY = 86_400;
const MICROS = 1_000_000;

/**
 * Turn accumulated observations into a score. Everything here is monotone in *unsolicited*
 * inflow: a payment the agent did not reciprocate can raise or keep a component, never lower
 * it. Penalties only come from flows the agent took part in.
 */
export function computeAgentScore(
  identity: { agent: Address; registry: RegistryKind; entity: EntityId },
  acc: AgentAccumulator,
  ctx: ScoringContext,
): Omit<AgentScore, "evidence"> {
  const m = ctx.methodology;
  const unit = Number(m.score.payerUnitMicros);

  let effectivePayers = 0;
  let repeatPayers = 0;
  let creditedTotal = 0n;
  let topCredited = 0n;
  for (const [payer, credited] of acc.creditedByPayer) {
    const w = Math.min(1, Number(credited) / unit);
    effectivePayers += w;
    if ((acc.daysByPayer.get(payer)?.size ?? 0) >= 2) repeatPayers += w;
    creditedTotal += credited;
    if (credited > topCredited) topCredited = credited;
  }
  const activeDays = acc.creditedDays.size;
  const totalFlow = acc.rawIn + acc.rawOut;
  const penalisedRatio = totalFlow > 0n ? ratio(acc.selfDealing + acc.wash, totalFlow) : 0;

  // FRESH_PAYERS: inflow from payer entities that were brand new at first payment and pay
  // nobody else.
  let freshExclusive = 0n;
  let rawNonSelf = 0n;
  for (const [payer, raw] of acc.rawByPayer) {
    rawNonSelf += raw;
    const first = acc.firstPaymentByPayer.get(payer);
    const seen = ctx.firstSeen(payer);
    const fresh =
      first !== undefined && seen !== undefined && first - seen < m.flags.freshWalletDays * DAY;
    if (fresh && ctx.payeeDegree(payer) <= 1) freshExclusive += raw;
  }
  const freshExclusiveShare = rawNonSelf > 0n ? ratio(freshExclusive, rawNonSelf) : 0;

  const creditedUsd = Number(creditedTotal) / MICROS;
  const components: ScoreComponents = {
    trust: 1 - Math.exp(-ctx.trustLift / 2),
    volume: Math.min(1, Math.log10(1 + creditedUsd) / Math.log10(1 + m.score.volumeTargetUsd)),
    payers: 1 - Math.exp(-effectivePayers / 10),
    repeat: 1 - Math.exp(-repeatPayers / 5),
    longevity: Math.min(1, activeDays / (m.windowDays / 2)),
  };
  const w = m.score.weights;
  const base =
    w.trust * components.trust +
    w.volume * components.volume +
    w.payers * components.payers +
    w.repeat * components.repeat +
    w.longevity * components.longevity;

  let score = Math.round(1000 * base * (1 - penalisedRatio) ** m.score.penaltyExponent);
  if (penalisedRatio > m.score.hardCapRatio) score = Math.min(score, m.score.hardCapScore);
  score = clamp(score, 0, 1000);

  const confidence = clamp(
    Math.round(10_000 * (1 - Math.exp(-effectivePayers / 3)) * (1 - Math.exp(-activeDays / 3))),
    0,
    10_000,
  );

  // BURST: last 24h credited vs trailing daily average.
  const today = Math.floor(ctx.asOf / DAY);
  let prior = 0n;
  for (const [day, v] of acc.creditedByDay) if (day < today) prior += v;
  const priorDays = Math.max(1, m.windowDays - 1);
  const avgPrior = Number(prior) / priorDays;
  const last24 = Number(acc.last24hCredited);
  const burst =
    last24 >= m.flags.burstMinUsd * MICROS && last24 >= m.flags.burstMultiplier * avgPrior;

  const uniquePayerWallets = acc.payerWallets.size;
  const uniquePayerEntities = acc.rawByPayer.size;
  const topPayerShare = creditedTotal > 0n ? ratio(topCredited, creditedTotal) : 0;

  let flags = 0;
  if (totalFlow > 0n && ratio(acc.selfDealing, totalFlow) >= m.flags.selfDealingRatio) {
    flags |= Flag.SELF_DEALING;
  }
  if (totalFlow > 0n && ratio(acc.wash, totalFlow) >= m.flags.circularRatio) {
    flags |= Flag.CIRCULAR_FLOW;
  }
  if (
    uniquePayerWallets >= m.flags.fundingClusterMinWallets &&
    uniquePayerEntities / uniquePayerWallets <= m.flags.fundingClusterEntityRatio
  ) {
    flags |= Flag.FUNDING_CLUSTER;
  }
  if (creditedTotal > 0n && topPayerShare >= m.flags.concentratedTopShare) {
    flags |= Flag.CONCENTRATED_PAYERS;
  }
  if (freshExclusiveShare >= m.flags.freshInflowShare) flags |= Flag.FRESH_PAYERS;
  if (burst) flags |= Flag.BURST;
  if (effectivePayers < m.flags.minEffectivePayers || activeDays < m.flags.minActiveDays) {
    flags |= Flag.INSUFFICIENT_DATA;
  }
  if (identity.registry === "wallet") flags |= Flag.UNREGISTERED;

  return {
    agent: identity.agent,
    registry: identity.registry,
    entity: identity.entity,
    score,
    confidence,
    flags,
    washRatioBps: clamp(Math.round(penalisedRatio * 10_000), 0, 10_000),
    uniquePayers: uniquePayerEntities,
    organicVolumeMicros: acc.organicIn,
    rawVolumeMicros: acc.rawIn,
    components,
    features: {
      rawInflowMicros: acc.rawIn,
      rawOutflowMicros: acc.rawOut,
      organicInflowMicros: acc.organicIn,
      creditedInflowMicros: creditedTotal,
      selfDealingMicros: acc.selfDealing,
      washCircularMicros: acc.wash,
      incidentalCircularMicros: acc.incidental,
      uniquePayerWallets,
      uniquePayerEntities,
      effectivePayers,
      repeatPayers,
      activeDays,
      trustLift: ctx.trustLift,
      penalisedRatio,
      topPayerShare,
      freshExclusiveShare,
      last24hCreditedMicros: acc.last24hCredited,
    },
  };
}

function ratio(a: bigint, b: bigint): number {
  return Number((a * 1_000_000n) / b) / 1_000_000;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
