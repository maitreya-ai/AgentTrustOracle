export interface PageRankOptions {
  damping: number;
  tolerance: number;
  maxIterations: number;
}

export interface PageRankResult {
  rank: Map<string, number>;
  iterations: number;
  converged: boolean;
}

/**
 * Personalised PageRank (TrustRank) over the payer → payee graph.
 *
 * Paying someone is a costly, revealed-preference endorsement. Trust starts at seed payers
 * (aged wallets that pay several unrelated services) and flows to payees in proportion to
 * spend. A sybil cluster that only pays itself gets almost no inbound trust from the honest
 * region, whatever its volume. That is the property SybilRank-style defences rely on.
 *
 * Adding an inbound edge to a node never lowers that node's PageRank (Avrachenkov & Litvak,
 * 2006), so a third party paying an agent cannot reduce its trust.
 *
 * Mass from dangling nodes (payees that never pay anyone) returns to the teleport
 * distribution, which keeps the vector stochastic.
 */
export function personalizedPageRank(
  nodes: readonly string[],
  edges: ReadonlyMap<string, ReadonlyMap<string, number>>,
  teleport: ReadonlyMap<string, number>,
  opts: PageRankOptions,
): PageRankResult {
  const sorted = [...nodes].sort();
  const n = sorted.length;
  if (n === 0) return { rank: new Map(), iterations: 0, converged: true };

  const idx = new Map(sorted.map((id, i) => [id, i]));

  // Normalised teleport vector (uniform if no seeds).
  const t = new Float64Array(n);
  let tSum = 0;
  for (const [id, w] of teleport) {
    const i = idx.get(id);
    if (i !== undefined && w > 0) {
      t[i] = w;
      tSum += w;
    }
  }
  if (tSum === 0) t.fill(1 / n);
  else for (let i = 0; i < n; i++) t[i] = (t[i] as number) / tSum;

  // Row-normalised adjacency as parallel arrays.
  const outIdx: number[][] = Array.from({ length: n }, () => []);
  const outW: number[][] = Array.from({ length: n }, () => []);
  for (const from of sorted) {
    const row = edges.get(from);
    if (!row) continue;
    const fi = idx.get(from) as number;
    let total = 0;
    for (const [, w] of row) if (w > 0) total += w;
    if (total === 0) continue;
    for (const to of [...row.keys()].sort()) {
      const w = row.get(to) as number;
      const ti = idx.get(to);
      if (ti === undefined || w <= 0) continue;
      (outIdx[fi] as number[]).push(ti);
      (outW[fi] as number[]).push(w / total);
    }
  }

  let r = Float64Array.from(t);
  let next = new Float64Array(n);
  const d = opts.damping;
  let iterations = 0;
  let converged = false;

  while (iterations < opts.maxIterations) {
    iterations++;
    next.fill(0);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const ri = r[i] as number;
      const targets = outIdx[i] as number[];
      if (targets.length === 0) {
        dangling += ri;
        continue;
      }
      const weights = outW[i] as number[];
      for (let k = 0; k < targets.length; k++) {
        const j = targets[k] as number;
        next[j] = (next[j] as number) + d * ri * (weights[k] as number);
      }
    }
    const teleportMass = d * dangling + (1 - d);
    let delta = 0;
    for (let i = 0; i < n; i++) {
      next[i] = (next[i] as number) + teleportMass * (t[i] as number);
      delta += Math.abs((next[i] as number) - (r[i] as number));
    }
    [r, next] = [next, r];
    if (delta < opts.tolerance) {
      converged = true;
      break;
    }
  }

  const rank = new Map<string, number>();
  for (let i = 0; i < n; i++) rank.set(sorted[i] as string, r[i] as number);
  return { rank, iterations, converged };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? ((s[mid - 1] as number) + (s[mid] as number)) / 2
    : (s[mid] as number);
}
