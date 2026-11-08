/**
 * Compute the next scoring epoch from indexed data.
 *
 *   bun src/main.ts            # compute + store epoch N = last published + 1
 *   bun src/main.ts --dry-run  # compute and print, store nothing
 *
 * Epoch numbers are leaf fields in the Merkle root, so they must match the onchain epoch
 * the publisher will write. An unpublished epoch N is therefore recomputed, never skipped.
 */
import { describeFlags, METHODOLOGY_V1, type Methodology, runEpoch } from "@ato/core";
import { createDb, createRepo } from "@ato/db";
import { KNOWN_FACILITATORS, PROGRAMS } from "@ato/solana";
import { z } from "zod";

const env = z
  .object({
    DATABASE_URL: z.string(),
    SCORE_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
    SCORE_UNREGISTERED_PAYEES: z
      .string()
      .default("true")
      .transform((v) => v === "true"),
  })
  .parse(process.env);
const dryRun = process.argv.includes("--dry-run");

const repo = createRepo(createDb(env.DATABASE_URL));
const methodology: Methodology = {
  ...METHODOLOGY_V1,
  windowDays: env.SCORE_WINDOW_DAYS,
  scoreUnregisteredPayees: env.SCORE_UNREGISTERED_PAYEES,
};

const published = await repo.latestEpoch("published");
const epoch = (published?.epoch ?? 0n) + 1n;
const asOf = Math.floor(Date.now() / 1000);

const t0 = performance.now();
const input = await repo.loadEpochInput(epoch, asOf, methodology.windowDays);
input.infrastructure = [...Object.keys(KNOWN_FACILITATORS), PROGRAMS.paymentChannels];
const result = runEpoch(input, methodology);
const ms = Math.round(performance.now() - t0);

const st = result.stats;
const usd = (m: bigint) =>
  `$${(Number(m) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
console.log(`epoch ${epoch}: ${result.scores.length} agents, ${st.paymentCount} payments, ${ms}ms`);
console.log(
  `  raw ${usd(st.rawVolumeMicros)} → organic ${usd(st.organicVolumeMicros)} (${(st.organicShareBps / 100).toFixed(1)}%)`,
);
console.log(
  `  self-dealing ${usd(st.selfDealingMicros)}, wash ${usd(st.washCircularMicros)}, incidental ${usd(st.incidentalCircularMicros)}`,
);
console.log(
  `  root ${result.merkleRoot}  methodology v${result.methodologyVersion} ${result.methodologyHash.slice(0, 16)}…`,
);
if (result.diagnostics.cyclesTruncated)
  console.warn("  ! cycle search hit its step budget; raise cycles.maxSearchSteps");
if (!result.diagnostics.pageRankConverged) console.warn("  ! trust propagation did not converge");

if (dryRun) {
  for (const s of [...result.scores].sort((a, b) => b.score - a.score).slice(0, 20)) {
    console.log(
      `  ${s.score.toString().padStart(4)}  ${s.agent}  ${describeFlags(s.flags).join(",")}`,
    );
  }
  process.exit(0);
}

await repo.deleteUnpublishedEpoch(epoch);
await repo.saveEpoch(result);
console.log(`stored epoch ${epoch}`);
process.exit(0);
