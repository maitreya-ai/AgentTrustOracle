/**
 * Directed weighted graph with bigint (micro-USD) capacities. Node and edge iteration is
 * always sorted, so every algorithm built on it is deterministic.
 */
export class FlowGraph {
  private out = new Map<string, Map<string, bigint>>();
  private inc = new Map<string, Map<string, bigint>>();

  static edgeKey(from: string, to: string): string {
    return `${from}->${to}`;
  }

  add(from: string, to: string, amount: bigint): void {
    if (amount <= 0n || from === to) return;
    this.bump(this.out, from, to, amount);
    this.bump(this.inc, to, from, amount);
    if (!this.out.has(to)) this.out.set(to, new Map());
    if (!this.inc.has(from)) this.inc.set(from, new Map());
  }

  get(from: string, to: string): bigint {
    return this.out.get(from)?.get(to) ?? 0n;
  }

  /** Subtract from an edge; removes it when it reaches zero. */
  reduce(from: string, to: string, amount: bigint): void {
    const cur = this.get(from, to);
    const next = cur - amount;
    if (next < 0n) throw new Error(`negative capacity on ${from}->${to}`);
    if (next === 0n) {
      this.out.get(from)?.delete(to);
      this.inc.get(to)?.delete(from);
    } else {
      this.out.get(from)?.set(to, next);
      this.inc.get(to)?.set(from, next);
    }
  }

  nodes(): string[] {
    return [...this.out.keys()].sort();
  }

  successors(node: string): string[] {
    return [...(this.out.get(node)?.keys() ?? [])].sort();
  }

  predecessors(node: string): string[] {
    return [...(this.inc.get(node)?.keys() ?? [])].sort();
  }

  outEdges(node: string): [string, bigint][] {
    return [...(this.out.get(node)?.entries() ?? [])].sort(([a], [b]) => (a < b ? -1 : 1));
  }

  inEdges(node: string): [string, bigint][] {
    return [...(this.inc.get(node)?.entries() ?? [])].sort(([a], [b]) => (a < b ? -1 : 1));
  }

  outTotal(node: string): bigint {
    let s = 0n;
    for (const v of this.out.get(node)?.values() ?? []) s += v;
    return s;
  }

  inTotal(node: string): bigint {
    let s = 0n;
    for (const v of this.inc.get(node)?.values() ?? []) s += v;
    return s;
  }

  *edges(): Generator<[string, string, bigint]> {
    for (const from of this.nodes()) {
      for (const [to, w] of this.outEdges(from)) yield [from, to, w];
    }
  }

  clone(): FlowGraph {
    const g = new FlowGraph();
    for (const [from, to, w] of this.edges()) g.add(from, to, w);
    for (const n of this.out.keys()) if (!g.out.has(n)) g.out.set(n, new Map());
    return g;
  }

  private bump(m: Map<string, Map<string, bigint>>, a: string, b: string, amount: bigint) {
    let inner = m.get(a);
    if (!inner) {
      inner = new Map();
      m.set(a, inner);
    }
    inner.set(b, (inner.get(b) ?? 0n) + amount);
  }
}

/** Tarjan's strongly connected components, iterative (no recursion-depth limit). */
export function stronglyConnectedComponents(g: FlowGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const start of g.nodes()) {
    if (index.has(start)) continue;
    const work: { node: string; succ: string[]; i: number }[] = [
      { node: start, succ: g.successors(start), i: 0 },
    ];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: string; succ: string[]; i: number };
      if (frame.i < frame.succ.length) {
        const next = frame.succ[frame.i++] as string;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter++;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, succ: g.successors(next), i: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(next) as number));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(
          parent.node,
          Math.min(low.get(parent.node) as number, low.get(frame.node) as number),
        );
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop() as string;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.node);
        result.push(component.sort());
      }
    }
  }
  return result;
}
