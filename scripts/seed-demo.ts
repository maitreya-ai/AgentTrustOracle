/**
 * Load the synthetic economy (honest agent, wash ring, self-dealer, sybil farm) into the
 * database, so the scorer, publisher and API can run end-to-end without mainnet data.
 *
 *   DATABASE_URL=... bun run db:migrate && bun run demo:seed && bun run score
 *
 * Payment timestamps are shifted so the scenario ends "now".
 */
import { syntheticEconomy } from "@ato/core/testing";
import { createDb, createRepo } from "@ato/db";

const repo = createRepo(createDb());
const economy = syntheticEconomy();
const shift = Math.floor(Date.now() / 1000) - economy.asOf;

await repo.upsertAgents(economy.agents);
await repo.insertPayments(economy.payments.map((p) => ({ ...p, blockTime: p.blockTime + shift })));
await repo.insertLinks(economy.links);
await repo.ensureProfiles(economy.wallets.map((w) => w.address));
for (const w of economy.wallets) {
  if (w.firstSeenAt === undefined) continue;
  await repo.saveProfile(w.address, {
    status: "resolved",
    firstSeenAt: w.firstSeenAt + shift,
    signature: "demo",
    ...(w.firstFunder ? { firstFunder: w.firstFunder } : {}),
  });
}
console.log(
  `seeded ${economy.agents.length} agents, ${economy.payments.length} payments, ${economy.wallets.length} wallet profiles`,
);
process.exit(0);
