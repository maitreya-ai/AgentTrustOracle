import { describeFlags, runEpoch } from "@ato/core";
import { addr, syntheticEconomy } from "@ato/core/testing";

const CASES = [
  { id: "honest-asset", label: "Honest agent", pattern: "20 aged customers, repeat usage" },
  { id: "farm-asset", label: "Sybil farm", pattern: "30 fresh wallets, one funder" },
  { id: "dealer-asset", label: "Self-dealer", pattern: "5 self-funded sock wallets" },
  { id: "wash-asset", label: "Wash ring", pattern: "W → R1 → R2 → W, $1k per lap" },
] as const;

export interface DemoRow {
  label: string;
  pattern: string;
  score: number;
  confidence: number;
  rawUsd: number;
  creditedUsd: number;
  payerWallets: number;
  payerEntities: number;
  flags: string[];
}

/** Score the synthetic economy with the production engine (runs at build time). */
export function demo() {
  const result = runEpoch(syntheticEconomy());
  const rows: DemoRow[] = CASES.map((c) => {
    const s = result.scores.find((x) => x.agent === addr(c.id));
    if (!s) throw new Error(`missing ${c.id}`);
    return {
      label: c.label,
      pattern: c.pattern,
      score: s.score,
      confidence: s.confidence / 100,
      rawUsd: Number(s.rawVolumeMicros) / 1e6,
      creditedUsd: Number(s.features.creditedInflowMicros) / 1e6,
      payerWallets: s.features.uniquePayerWallets,
      payerEntities: s.uniquePayers,
      flags: describeFlags(s.flags).filter(
        (f) => f !== "INSUFFICIENT_DATA" && f !== "UNREGISTERED",
      ),
    };
  });
  const st = result.stats;
  return {
    rows,
    stats: {
      rawUsd: Number(st.rawVolumeMicros) / 1e6,
      organicUsd: Number(st.organicVolumeMicros) / 1e6,
      washUsd: Number(st.washCircularMicros) / 1e6,
      selfDealingUsd: Number(st.selfDealingMicros) / 1e6,
      organicShare: st.organicShareBps / 100,
    },
    methodologyHash: result.methodologyHash,
  };
}
