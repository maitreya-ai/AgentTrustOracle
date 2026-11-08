import { describe, expect, test } from "bun:test";
import { resolveEntities } from "./entities";
import { METHODOLOGY_V1 } from "./methodology";
import { addr } from "./testing";
import type { WalletLink } from "./types";

const [A, B, C, D] = ["a", "b", "c", "d"].map(addr) as [string, string, string, string];

describe("resolveEntities", () => {
  test("hard links merge and the entity id is the smallest member", () => {
    const links: WalletLink[] = [{ from: A, to: B, kind: "fee_payer" }];
    const r = resolveEntities([A, B, C], links, METHODOLOGY_V1);
    expect(r.entityOf(A)).toBe(r.entityOf(B));
    expect(r.entityOf(A)).toBe([A, B].sort()[0] as string);
    expect(r.entityOf(C)).toBe(C);
  });

  test("links are transitive", () => {
    const links: WalletLink[] = [
      { from: A, to: B, kind: "registry_agent_wallet" },
      { from: B, to: C, kind: "close_destination" },
    ];
    const r = resolveEntities([A, B, C, D], links, METHODOLOGY_V1);
    expect(new Set([r.entityOf(A), r.entityOf(B), r.entityOf(C)]).size).toBe(1);
    expect(r.entityOf(D)).not.toBe(r.entityOf(A));
  });

  test("hub funders (CEX hot wallets) do not merge their customers", () => {
    const cex = addr("cex");
    const customers = Array.from({ length: 60 }, (_, i) => addr(`cust${i}`));
    const links: WalletLink[] = customers.map((c) => ({ from: c, to: cex, kind: "funded_by" }));
    const r = resolveEntities(customers, links, METHODOLOGY_V1);
    expect(new Set(customers.map(r.entityOf)).size).toBe(60);
    expect(r.hubs).toContain(`funded_by:${cex}`);
  });

  test("small funding clusters do merge (sybil farm)", () => {
    const funder = addr("farm-funder");
    const socks = Array.from({ length: 10 }, (_, i) => addr(`sock${i}`));
    const links: WalletLink[] = socks.map((s) => ({ from: s, to: funder, kind: "funded_by" }));
    const r = resolveEntities(socks, links, METHODOLOGY_V1);
    expect(new Set(socks.map(r.entityOf)).size).toBe(1);
    expect(r.softMerged.has(r.entityOf(socks[0] as string))).toBe(true);
  });

  test("infrastructure addresses are never used for clustering", () => {
    const facilitator = addr("facilitator");
    const links: WalletLink[] = [
      { from: A, to: facilitator, kind: "fee_payer" },
      { from: B, to: facilitator, kind: "fee_payer" },
    ];
    const r = resolveEntities([A, B], links, METHODOLOGY_V1, new Set([facilitator]));
    expect(r.entityOf(A)).not.toBe(r.entityOf(B));
  });
});
