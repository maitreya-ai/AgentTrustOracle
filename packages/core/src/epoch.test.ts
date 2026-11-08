import { describe, expect, test } from "bun:test";
import { hexToBytes } from "@noble/hashes/utils.js";
import { runEpoch } from "./epoch";
import { Flag, hasFlag } from "./flags";
import { hashLeaf, verifyProof } from "./merkle";
import { addr, pay, SCENARIO_CLOCK, syntheticEconomy } from "./testing";
import { REGISTRY_CODE } from "./types";

const { t } = SCENARIO_CLOCK;
const economy = syntheticEconomy;

const scoreOf = (r: ReturnType<typeof runEpoch>, id: string) => {
  const s = r.scores.find((x) => x.agent === id);
  if (!s) throw new Error(`no score for ${id}`);
  return s;
};

describe("runEpoch: manipulation patterns", () => {
  const result = runEpoch(economy());
  const honest = scoreOf(result, addr("honest-asset"));
  const wash = scoreOf(result, addr("wash-asset"));
  const dealer = scoreOf(result, addr("dealer-asset"));
  const farm = scoreOf(result, addr("farm-asset"));

  test("honest agent scores well and carries no penalising flags", () => {
    expect(honest.score).toBeGreaterThan(500);
    expect(hasFlag(honest.flags, Flag.SELF_DEALING)).toBe(false);
    expect(hasFlag(honest.flags, Flag.CIRCULAR_FLOW)).toBe(false);
    expect(honest.uniquePayers).toBe(20);
    expect(honest.confidence).toBeGreaterThan(9_000);
  });

  test("wash ring scores ~0 and is flagged circular", () => {
    expect(wash.score).toBeLessThan(50);
    expect(hasFlag(wash.flags, Flag.CIRCULAR_FLOW)).toBe(true);
    expect(wash.organicVolumeMicros).toBe(0n);
    expect(wash.washRatioBps).toBeGreaterThan(9_000);
  });

  test("self-dealing via self-funded sock wallets is caught", () => {
    expect(dealer.score).toBeLessThan(50);
    expect(hasFlag(dealer.flags, Flag.SELF_DEALING)).toBe(true);
    expect(dealer.features.selfDealingMicros).toBe(dealer.features.rawInflowMicros);
  });

  test("a fresh sybil payer farm collapses into one entity and earns little", () => {
    expect(farm.score).toBeLessThan(honest.score / 3);
    expect(farm.uniquePayers).toBe(1);
    expect(hasFlag(farm.flags, Flag.FUNDING_CLUSTER)).toBe(true);
    expect(hasFlag(farm.flags, Flag.FRESH_PAYERS)).toBe(true);
  });

  test("ecosystem stats separate raw from organic volume", () => {
    expect(result.stats.organicVolumeMicros).toBeLessThan(result.stats.rawVolumeMicros);
    expect(result.stats.washCircularMicros).toBe(30_000_000_000n);
    expect(result.stats.selfDealingMicros).toBe(500_000_000n);
    expect(result.stats.organicShareBps).toBeLessThan(1_000);
  });

  test("unregistered payees with real inflow are scored for cold-start coverage", () => {
    const s1 = scoreOf(result, addr("service1"));
    expect(s1.registry).toBe("wallet");
    expect(hasFlag(s1.flags, Flag.UNREGISTERED)).toBe(true);
  });
});

describe("runEpoch: verifiability", () => {
  test("is deterministic: same input, same root and hashes", () => {
    const a = runEpoch(economy());
    const b = runEpoch(economy());
    expect(a.merkleRoot).toBe(b.merkleRoot);
    expect(a.inputsHash).toBe(b.inputsHash);
    expect(a.methodologyHash).toBe(b.methodologyHash);
  });

  test("input order does not matter", () => {
    const input = economy();
    const shuffled = { ...input, payments: [...input.payments].reverse() };
    expect(runEpoch(shuffled).merkleRoot).toBe(runEpoch(input).merkleRoot);
  });

  test("every agent's proof verifies against the root", () => {
    const r = runEpoch(economy());
    const root = hexToBytes(r.merkleRoot);
    for (const s of r.scores) {
      const leaf = hashLeaf({
        agent: s.agent,
        registry: REGISTRY_CODE[s.registry],
        epoch: r.epoch,
        score: s.score,
        confidence: s.confidence,
        flags: s.flags,
        washRatioBps: s.washRatioBps,
        uniquePayers: s.uniquePayers,
        organicVolume: s.organicVolumeMicros,
      });
      const proof = (r.proofs.get(s.agent) ?? []).map((h) => hexToBytes(h));
      expect(verifyProof(leaf, proof, root)).toBe(true);
    }
  });
});

describe("runEpoch: griefing resistance", () => {
  test("unsolicited payments from fresh attacker wallets cannot lower a score", () => {
    const base = economy();
    const before = scoreOf(runEpoch(base), addr("honest-asset"));

    const attacked = economy();
    const attackerFunder = addr("attacker-funder");
    for (let i = 0; i < 25; i++) {
      const a = addr(`attacker${i}`);
      attacked.wallets.push({ address: a, firstSeenAt: t(0.1), firstFunder: attackerFunder });
      attacked.payments.push(pay(a, addr("honest"), 50, t(0.05, i)));
    }
    const after = scoreOf(runEpoch(attacked), addr("honest-asset"));

    expect(after.score).toBeGreaterThanOrEqual(before.score);
    expect(hasFlag(after.flags, Flag.SELF_DEALING)).toBe(false);
    expect(hasFlag(after.flags, Flag.CIRCULAR_FLOW)).toBe(false);
  });
});
