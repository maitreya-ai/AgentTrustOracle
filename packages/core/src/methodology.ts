import { canonicalJson, sha256Hex } from "./hash";
import type { LinkKind } from "./types";

/**
 * Every tunable in the scoring pipeline. A methodology is identified by the SHA-256 of its
 * canonical JSON, and that hash is committed onchain with every epoch, so anyone can re-run
 * the exact pipeline that produced a score.
 *
 * Changing ANY value = new methodology. Bump `version` when you do.
 */
export interface Methodology {
  version: number;
  /** Rolling scoring window. */
  windowDays: number;
  /** Payments below this value are ignored entirely (dust / address-poisoning). */
  minPaymentMicros: bigint;

  entities: {
    /** `hard` links merge on sight; `soft` links merge only below `softFanoutCap`. */
    strength: Record<LinkKind, "hard" | "soft">;
    /**
     * An address with more distinct counterparts than this for a link kind is treated as
     * shared infrastructure (CEX hot wallet, launchpad, relayer) and its links of that kind
     * are dropped.
     */
    hubFanout: Record<LinkKind, number>;
    softFanoutCap: number;
  };

  cycles: {
    maxCycleLength: number;
    /** DFS step budget per epoch; the run is marked truncated if exhausted. */
    maxSearchSteps: number;
    /**
     * A cycle counts as a wash ring (penalised) when its bottleneck carries at least this
     * share of the throughput of the least-active participant. Below it the circulation is
     * "incidental": still excluded from organic volume, but not penalised.
     */
    intensityThreshold: number;
  };

  trust: {
    damping: number;
    tolerance: number;
    maxIterations: number;
    /** Payer seed weight saturates at this wallet age. */
    seedAgeDays: number;
    /** Payer seed weight saturates at this many distinct unrelated payee entities. */
    seedPayeeDiversity: number;
    /** Edge weight transform applied to organic micro-USD before propagation. */
    edgeTransform: "linear" | "sqrt" | "log";
  };

  score: {
    /** Credited micro-USD a payer must contribute to count as one "effective payer". */
    payerUnitMicros: bigint;
    /** Organic credited volume (USD) at which the volume component saturates. */
    volumeTargetUsd: number;
    weights: {
      trust: number;
      volume: number;
      payers: number;
      repeat: number;
      longevity: number;
    };
    /** Exponent on (1 - penalisedRatio). */
    penaltyExponent: number;
    /** When penalisedRatio exceeds this, the score is capped at `hardCapScore`. */
    hardCapRatio: number;
    hardCapScore: number;
  };

  flags: {
    selfDealingRatio: number;
    circularRatio: number;
    fundingClusterMinWallets: number;
    fundingClusterEntityRatio: number;
    concentratedTopShare: number;
    freshWalletDays: number;
    freshInflowShare: number;
    burstMultiplier: number;
    burstMinUsd: number;
    minEffectivePayers: number;
    minActiveDays: number;
  };

  /** Score raw payee wallets that are not in any registry (cold-start coverage). */
  scoreUnregisteredPayees: boolean;
  /** Minimum raw inflow (micro-USD) for an unregistered payee to be scored. */
  unregisteredMinInflowMicros: bigint;
}

export const METHODOLOGY_V1: Methodology = {
  version: 1,
  windowDays: 30,
  minPaymentMicros: 1n,

  entities: {
    strength: {
      registry_owner: "hard",
      registry_agent_wallet: "hard",
      registry_creator: "soft",
      registry_parent: "hard",
      funded_by: "soft",
      fee_payer: "hard",
      channel_rent_payer: "soft",
      close_destination: "hard",
    },
    hubFanout: {
      registry_owner: 10_000,
      registry_agent_wallet: 10_000,
      registry_creator: 25,
      registry_parent: 100,
      funded_by: 50,
      fee_payer: 25,
      channel_rent_payer: 25,
      close_destination: 25,
    },
    softFanoutCap: 50,
  },

  cycles: {
    maxCycleLength: 5,
    maxSearchSteps: 5_000_000,
    intensityThreshold: 0.25,
  },

  trust: {
    damping: 0.85,
    tolerance: 1e-10,
    maxIterations: 200,
    seedAgeDays: 30,
    seedPayeeDiversity: 3,
    edgeTransform: "sqrt",
  },

  score: {
    payerUnitMicros: 100_000n, // $0.10
    volumeTargetUsd: 10_000,
    weights: { trust: 0.3, volume: 0.2, payers: 0.25, repeat: 0.1, longevity: 0.15 },
    penaltyExponent: 2,
    hardCapRatio: 0.5,
    hardCapScore: 200,
  },

  flags: {
    selfDealingRatio: 0.05,
    circularRatio: 0.05,
    fundingClusterMinWallets: 5,
    fundingClusterEntityRatio: 0.3,
    concentratedTopShare: 0.8,
    freshWalletDays: 7,
    freshInflowShare: 0.5,
    burstMultiplier: 5,
    burstMinUsd: 50,
    minEffectivePayers: 3,
    minActiveDays: 3,
  },

  scoreUnregisteredPayees: true,
  unregisteredMinInflowMicros: 1_000_000n, // $1
};

export function methodologyHash(methodology: Methodology): string {
  return sha256Hex(canonicalJson(methodology));
}
