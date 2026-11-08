/**
 * Run the synthetic economy through the scoring pipeline and print a score table.
 * Sanity-check methodology changes with: `bun run simulate`.
 */
import { describeFlags, runEpoch } from "@ato/core";
import { addr, syntheticEconomy } from "@ato/core/testing";

const labels = new Map(
  ["honest-asset", "wash-asset", "dealer-asset", "farm-asset", "service1", "service2"].map((l) => [
    addr(l),
    l,
  ]),
);

const result = runEpoch(syntheticEconomy());
const usd = (m: bigint) => `$${(Number(m) / 1e6).toFixed(2)}`;

console.table(
  result.scores.map((s) => ({
    agent: labels.get(s.agent) ?? `${s.agent.slice(0, 6)}…`,
    score: s.score,
    confidence: `${(s.confidence / 100).toFixed(1)}%`,
    raw: usd(s.rawVolumeMicros),
    organic: usd(s.organicVolumeMicros),
    credited: usd(s.features.creditedInflowMicros),
    "payers (wallets→entities)": `${s.features.uniquePayerWallets}→${s.uniquePayers}`,
    wash: `${(s.washRatioBps / 100).toFixed(1)}%`,
    flags: describeFlags(s.flags).join(","),
  })),
);

const st = result.stats;
console.log(
  `raw ${usd(st.rawVolumeMicros)} | organic ${usd(st.organicVolumeMicros)} (${(st.organicShareBps / 100).toFixed(1)}%) | self-dealing ${usd(st.selfDealingMicros)} | wash ${usd(st.washCircularMicros)}`,
);
console.log(`merkle root   ${result.merkleRoot}`);
console.log(`methodology   v${result.methodologyVersion} ${result.methodologyHash}`);
