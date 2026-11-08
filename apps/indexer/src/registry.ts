import {
  AGENT_REGISTRY_8004,
  Erc8004Provider,
  type IdentityProvider,
  type RegistryAgent,
} from "@ato/solana";
import type { IndexerContext } from "./context";

/** Pull every agent from the configured registries and upsert identities + wallet profiles. */
export async function syncRegistries(ctx: IndexerContext) {
  const cluster = ctx.env.SOLANA_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet";
  const providers: IdentityProvider[] = [
    new Erc8004Provider(ctx.rpc as never, AGENT_REGISTRY_8004[cluster]),
  ];
  for (const provider of providers) {
    const agents: RegistryAgent[] = [];
    for await (const a of provider.listAgents()) agents.push(a);
    await ctx.repo.upsertAgents(agents);
    await ctx.repo.ensureProfiles(
      agents.flatMap((a) => [...a.wallets, ...(a.owner ? [a.owner] : [])]),
    );
    console.log(`[registry] ${provider.registry}: ${agents.length} agents`);
  }
}
