import { describe, expect, test } from "bun:test";
import { median, personalizedPageRank } from "./trust-rank";

const opts = { damping: 0.85, tolerance: 1e-12, maxIterations: 500 };

function edges(list: [string, string, number][]) {
  const m = new Map<string, Map<string, number>>();
  for (const [a, b, w] of list) {
    if (!m.has(a)) m.set(a, new Map());
    m.get(a)?.set(b, w);
  }
  return m;
}

describe("personalizedPageRank", () => {
  test("is a probability distribution", () => {
    const nodes = ["a", "b", "c"];
    const r = personalizedPageRank(
      nodes,
      edges([
        ["a", "b", 1],
        ["b", "c", 1],
      ]),
      new Map([["a", 1]]),
      opts,
    );
    const total = [...r.rank.values()].reduce((s, x) => s + x, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(r.converged).toBe(true);
  });

  test("a sybil cluster disconnected from seeds gets ~no trust", () => {
    const honest = Array.from({ length: 10 }, (_, i) => `h${i}`);
    const sybils = Array.from({ length: 50 }, (_, i) => `s${i}`);
    const list: [string, string, number][] = [];
    for (const h of honest) list.push([h, "merchant", 1]);
    for (const s of sybils) list.push([s, "sybil-merchant", 1_000]);
    const teleport = new Map(honest.map((h) => [h, 1]));
    const r = personalizedPageRank(
      [...honest, ...sybils, "merchant", "sybil-merchant"],
      edges(list),
      teleport,
      opts,
    );
    expect(r.rank.get("sybil-merchant") ?? 0).toBeLessThan(1e-9);
    expect(r.rank.get("merchant") ?? 0).toBeGreaterThan(0.3);
  });

  test("adding an inbound edge never lowers the target's rank", () => {
    const nodes = ["a", "b", "c", "d"];
    const base: [string, string, number][] = [
      ["a", "b", 1],
      ["a", "c", 1],
      ["c", "d", 1],
    ];
    const teleport = new Map([
      ["a", 1],
      ["c", 1],
    ]);
    const before = personalizedPageRank(nodes, edges(base), teleport, opts).rank.get("d") ?? 0;
    const after =
      personalizedPageRank(nodes, edges([...base, ["b", "d", 1]]), teleport, opts).rank.get("d") ??
      0;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("median", () => {
  test("odd, even, empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
