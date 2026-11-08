import { FlowGraph, stronglyConnectedComponents } from "./graph";

export interface CycleEvidence {
  /** Entity path; the cycle closes back to path[0]. */
  path: string[];
  /** Micro-USD cancelled around the cycle. */
  amount: bigint;
  /** bottleneck / min participant throughput, in [0, 1]. */
  intensity: number;
  /** True when intensity >= threshold (wash ring, penalised). */
  wash: boolean;
}

export interface CycleCancellation {
  /** Flow left after removing every circulation found: the net, acyclic economy. */
  residual: FlowGraph;
  /** Per-edge circulation in wash rings (penalised). */
  washByEdge: Map<string, bigint>;
  /** Per-edge circulation below the intensity threshold (excluded, not penalised). */
  incidentalByEdge: Map<string, bigint>;
  cycles: CycleEvidence[];
  /** True if the search step budget ran out before every cycle was examined. */
  truncated: boolean;
}

export interface CycleOptions {
  maxCycleLength: number;
  maxSearchSteps: number;
  intensityThreshold: number;
}

/**
 * Greedy cycle cancellation on an aggregated flow graph.
 *
 * Money that goes around a loop and comes back is evidence of nothing: if A pays B $100 and
 * B pays A $100, net demand is zero. Cancelling cycles (shortest first, so reciprocal
 * 2-cycles go first and are easiest to explain) leaves the acyclic "net" economy, and each
 * agent is credited only for that part.
 *
 * Penalties need a stronger signal than "a cycle exists", because real economies have long
 * incidental loops. A cycle only counts as a wash ring if it carries a large share
 * (`intensityThreshold`) of the throughput of every participant.
 *
 * Determinism: nodes and successors are visited in sorted order. When processing start node
 * `s`, only nodes > `s` are explored, so each cycle is found from its minimum node.
 * Cancellation only ever removes capacity, so no new cycle can appear later.
 */
export function cancelCycles(graph: FlowGraph, opts: CycleOptions): CycleCancellation {
  const residual = graph.clone();
  const washByEdge = new Map<string, bigint>();
  const incidentalByEdge = new Map<string, bigint>();
  const cycles: CycleEvidence[] = [];

  const throughput = new Map<string, bigint>();
  for (const n of graph.nodes()) {
    const inT = graph.inTotal(n);
    const outT = graph.outTotal(n);
    // biome-ignore lint/complexity/useMathMinMax: bigint operands (Math.max is number-only)
    throughput.set(n, inT > outT ? inT : outT);
  }

  let steps = 0;
  let truncated = false;

  const components = stronglyConnectedComponents(residual).filter((c) => c.length > 1);

  outer: for (let len = 2; len <= opts.maxCycleLength; len++) {
    for (const component of components) {
      const members = new Set(component);
      for (const start of component) {
        while (true) {
          const found = findCycle(residual, start, len, members, () => {
            steps++;
            return steps <= opts.maxSearchSteps;
          });
          if (found === "budget") {
            truncated = true;
            break outer;
          }
          if (!found) break;

          let bottleneck = -1n;
          for (let i = 0; i < found.length; i++) {
            const w = residual.get(found[i] as string, found[(i + 1) % found.length] as string);
            if (bottleneck < 0n || w < bottleneck) bottleneck = w;
          }
          let minThroughput = -1n;
          for (const n of found) {
            const t = throughput.get(n) ?? 0n;
            if (minThroughput < 0n || t < minThroughput) minThroughput = t;
          }
          const intensity =
            minThroughput > 0n ? Number((bottleneck * 1_000_000n) / minThroughput) / 1_000_000 : 1;
          const wash = intensity >= opts.intensityThreshold;
          const bucket = wash ? washByEdge : incidentalByEdge;

          for (let i = 0; i < found.length; i++) {
            const from = found[i] as string;
            const to = found[(i + 1) % found.length] as string;
            residual.reduce(from, to, bottleneck);
            const key = FlowGraph.edgeKey(from, to);
            bucket.set(key, (bucket.get(key) ?? 0n) + bottleneck);
          }
          cycles.push({ path: found, amount: bottleneck, intensity, wash });
        }
      }
    }
  }

  return { residual, washByEdge, incidentalByEdge, cycles, truncated };
}

/**
 * Find one simple cycle of length <= maxLen through `start`, using only nodes > start inside
 * `allowed`. Returns the node path, null if there is none, or "budget" if `tick` refused.
 */
function findCycle(
  g: FlowGraph,
  start: string,
  maxLen: number,
  allowed: ReadonlySet<string>,
  tick: () => boolean,
): string[] | null | "budget" {
  const path = [start];
  const onPath = new Set([start]);
  const iters: string[][] = [g.successors(start)];
  const pos: number[] = [0];

  while (iters.length > 0) {
    if (!tick()) return "budget";
    const depth = iters.length - 1;
    const succ = iters[depth] as string[];
    const i = pos[depth] as number;
    if (i >= succ.length) {
      iters.pop();
      pos.pop();
      onPath.delete(path.pop() as string);
      continue;
    }
    pos[depth] = i + 1;
    const next = succ[i] as string;
    if (next === start && path.length >= 2) return [...path];
    if (next <= start || onPath.has(next) || !allowed.has(next)) continue;
    if (path.length >= maxLen) continue;
    path.push(next);
    onPath.add(next);
    iters.push(g.successors(next));
    pos.push(0);
  }
  return null;
}
