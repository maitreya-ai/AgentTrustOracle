import { describe, expect, test } from "bun:test";
import { cancelCycles } from "./cycles";
import { FlowGraph, stronglyConnectedComponents } from "./graph";

const opts = { maxCycleLength: 5, maxSearchSteps: 1_000_000, intensityThreshold: 0.25 };

describe("stronglyConnectedComponents", () => {
  test("finds cycles and singletons", () => {
    const g = new FlowGraph();
    g.add("a", "b", 1n);
    g.add("b", "c", 1n);
    g.add("c", "a", 1n);
    g.add("c", "d", 1n);
    const sccs = stronglyConnectedComponents(g).map((c) => c.join(","));
    expect(sccs).toContain("a,b,c");
    expect(sccs).toContain("d");
  });
});

describe("cancelCycles", () => {
  test("reciprocal flow cancels down to the net amount", () => {
    const g = new FlowGraph();
    g.add("a", "b", 100n);
    g.add("b", "a", 60n);
    const r = cancelCycles(g, opts);
    expect(r.residual.get("a", "b")).toBe(40n);
    expect(r.residual.get("b", "a")).toBe(0n);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]?.amount).toBe(60n);
  });

  test("a closed wash ring is removed entirely and marked as wash", () => {
    const g = new FlowGraph();
    g.add("a", "b", 1_000n);
    g.add("b", "c", 1_000n);
    g.add("c", "a", 1_000n);
    const r = cancelCycles(g, opts);
    expect([...r.residual.edges()]).toHaveLength(0);
    expect(r.cycles[0]?.wash).toBe(true);
    expect(r.washByEdge.get(FlowGraph.edgeKey("a", "b"))).toBe(1_000n);
  });

  test("acyclic flow is untouched", () => {
    const g = new FlowGraph();
    g.add("a", "b", 10n);
    g.add("b", "c", 10n);
    g.add("a", "c", 10n);
    const r = cancelCycles(g, opts);
    expect([...r.residual.edges()]).toEqual([...g.edges()]);
    expect(r.cycles).toHaveLength(0);
  });

  test("a small loop between busy honest merchants is incidental, not wash", () => {
    const g = new FlowGraph();
    // a and b each move $10k with the wider economy; they also trade $50 with each other.
    g.add("x", "a", 10_000n);
    g.add("b", "y", 10_000n);
    g.add("a", "b", 50n);
    g.add("b", "a", 50n);
    const r = cancelCycles(g, opts);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]?.wash).toBe(false);
    expect(r.washByEdge.size).toBe(0);
    expect(r.incidentalByEdge.get(FlowGraph.edgeKey("a", "b"))).toBe(50n);
  });

  test("respects the maximum cycle length", () => {
    const g = new FlowGraph();
    const ring = ["n0", "n1", "n2", "n3", "n4", "n5"];
    ring.forEach((n, i) => {
      g.add(n, ring[(i + 1) % ring.length] as string, 5n);
    });
    const r = cancelCycles(g, { ...opts, maxCycleLength: 5 });
    expect(r.cycles).toHaveLength(0);
    const r6 = cancelCycles(g, { ...opts, maxCycleLength: 6 });
    expect(r6.cycles).toHaveLength(1);
  });

  test("reports truncation when the step budget runs out", () => {
    const g = new FlowGraph();
    g.add("a", "b", 1n);
    g.add("b", "a", 1n);
    const r = cancelCycles(g, { ...opts, maxSearchSteps: 1 });
    expect(r.truncated).toBe(true);
  });
});
