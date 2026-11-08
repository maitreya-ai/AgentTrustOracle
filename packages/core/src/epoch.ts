import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { type CycleEvidence, cancelCycles } from "./cycles";
import { type EntityId, resolveEntities } from "./entities";
import { FlowGraph } from "./graph";
import { buildMerkleTree, getProof, hashLeaf, toHex } from "./merkle";
import { METHODOLOGY_V1, type Methodology, methodologyHash } from "./methodology";
import {
  type AgentAccumulator,
  type AgentScore,
  computeAgentScore,
  newAccumulator,
} from "./scoring";
import { median, personalizedPageRank } from "./trust-rank";
import {
  type Address,
  type AgentIdentity,
  type Payment,
  type PaymentRail,
  REGISTRY_CODE,
  type WalletLink,
  type WalletProfile,
} from "./types";

export interface EpochInput {
  epoch: bigint;
  /** Unix seconds. The window is (asOf - windowDays, asOf]. */
  asOf: number;
  payments: readonly Payment[];
  links: readonly WalletLink[];
  wallets: readonly WalletProfile[];
  agents: readonly AgentIdentity[];
  /** Facilitators, programs, treasuries: never clustered, never scored. */
  infrastructure?: readonly Address[];
}

export interface EcosystemStats {
  paymentCount: number;
  rawVolumeMicros: bigint;
  selfDealingMicros: bigint;
  washCircularMicros: bigint;
  incidentalCircularMicros: bigint;
  organicVolumeMicros: bigint;
  creditedVolumeMicros: bigint;
  /** organic / raw, in bps: the "honest volume" headline number. */
  organicShareBps: number;
  byRail: Record<PaymentRail, { count: number; rawVolumeMicros: bigint }>;
  uniquePayerWallets: number;
  uniquePayeeWallets: number;
  entityCount: number;
}

export interface EpochResult {
  epoch: bigint;
  asOf: number;
  windowStart: number;
  methodologyVersion: number;
  methodologyHash: string;
  inputsHash: string;
  merkleRoot: string;
  /** Sorted by agent id; index i is leaf i of the Merkle tree. */
  scores: AgentScore[];
  proofs: Map<Address, string[]>;
  stats: EcosystemStats;
  diagnostics: {
    cyclesFound: number;
    cyclesTruncated: boolean;
    pageRankIterations: number;
    pageRankConverged: boolean;
    hubs: readonly string[];
  };
}

const DAY = 86_400;

/**
 * Run one scoring epoch. Pure and deterministic: the same input and methodology always give
 * byte-identical output (including the Merkle root), which is what makes scores verifiable.
 */
export function runEpoch(
  input: EpochInput,
  methodology: Methodology = METHODOLOGY_V1,
): EpochResult {
  const windowStart = input.asOf - methodology.windowDays * DAY;
  const infra = new Set(input.infrastructure ?? []);

  const payments = input.payments
    .filter(
      (p) =>
        p.blockTime > windowStart &&
        p.blockTime <= input.asOf &&
        p.usdMicros >= methodology.minPaymentMicros &&
        p.payer !== p.payee,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── 1. Identities and wallet attribution ─────────────────────────────────────────────
  const registered = dedupeAgents(input.agents);
  const attribution = attributeWallets(registered);

  const rawInByWallet = new Map<Address, bigint>();
  for (const p of payments) {
    rawInByWallet.set(p.payee, (rawInByWallet.get(p.payee) ?? 0n) + p.usdMicros);
  }
  const agents: AgentIdentity[] = [...registered];
  if (methodology.scoreUnregisteredPayees) {
    for (const [wallet, raw] of [...rawInByWallet].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (attribution.has(wallet) || infra.has(wallet)) continue;
      if (raw < methodology.unregisteredMinInflowMicros) continue;
      agents.push({ id: wallet, registry: "wallet", wallets: [wallet] });
      attribution.set(wallet, wallet);
    }
  }
  agents.sort((a, b) => (a.id < b.id ? -1 : 1));

  // ── 2. Entity resolution ─────────────────────────────────────────────────────────────
  const links = [...input.links, ...registryLinks(registered), ...fundingLinks(input.wallets)];
  const universe = new Set<Address>();
  for (const p of payments) {
    universe.add(p.payer);
    universe.add(p.payee);
  }
  for (const a of agents) for (const w of a.wallets) universe.add(w);
  const entities = resolveEntities(universe, links, methodology, infra);
  const E = (a: Address) => entities.entityOf(a);

  // ── 3. Entity flow graph (self-dealing removed) ──────────────────────────────────────
  const graph = new FlowGraph();
  let selfDealingTotal = 0n;
  for (const p of payments) {
    const from = E(p.payer);
    const to = E(p.payee);
    if (from === to) selfDealingTotal += p.usdMicros;
    else graph.add(from, to, p.usdMicros);
  }

  // ── 4. Circulation removal ───────────────────────────────────────────────────────────
  const cancellation = cancelCycles(graph, methodology.cycles);
  const { residual, washByEdge, incidentalByEdge } = cancellation;

  // ── 5. Trust propagation ─────────────────────────────────────────────────────────────
  const { firstSeen, profileFirstSeen } = entityFirstSeen(input.wallets, payments, E);
  const trustEdges = new Map<string, Map<string, number>>();
  const seeds = new Map<string, number>();
  for (const [from, to, w] of residual.edges()) {
    let row = trustEdges.get(from);
    if (!row) {
      row = new Map();
      trustEdges.set(from, row);
    }
    row.set(to, transform(w, methodology.trust.edgeTransform));
  }
  const entityNodes = graph.nodes();
  for (const e of entityNodes) {
    const seen = firstSeen.get(e);
    const ageDays = seen === undefined ? 0 : (input.asOf - seen) / DAY;
    const ageFactor = Math.min(1, Math.max(0, ageDays / methodology.trust.seedAgeDays));
    const diversity = Math.min(
      1,
      residual.successors(e).length / methodology.trust.seedPayeeDiversity,
    );
    const seed = ageFactor * diversity;
    if (seed > 0) seeds.set(e, seed);
  }
  const pr = personalizedPageRank(entityNodes, trustEdges, seeds, methodology.trust);
  const seededRanks = [...seeds.keys()].map((e) => pr.rank.get(e) ?? 0);
  let prRef = median(seededRanks);
  if (prRef <= 0) prRef = Math.max(0, ...pr.rank.values());
  if (prRef <= 0) prRef = 1;
  const credibility = (e: EntityId) => Math.min(1, (pr.rank.get(e) ?? 0) / prRef);

  // ── 6. Per-agent accumulation ────────────────────────────────────────────────────────
  const accumulators = new Map<Address, AgentAccumulator>();
  for (const a of agents) accumulators.set(a.id, newAccumulator());
  let creditedTotal = 0n;

  const share = (amount: bigint, part: bigint, whole: bigint) =>
    whole > 0n ? (amount * part) / whole : 0n;

  for (const p of payments) {
    const from = E(p.payer);
    const to = E(p.payee);
    const self = from === to;
    const key = FlowGraph.edgeKey(from, to);
    const whole = self ? 0n : graph.get(from, to);
    const organic = self ? 0n : share(p.usdMicros, residual.get(from, to), whole);
    const wash = self ? 0n : share(p.usdMicros, washByEdge.get(key) ?? 0n, whole);
    const incidental = self ? 0n : share(p.usdMicros, incidentalByEdge.get(key) ?? 0n, whole);
    const credited = BigInt(Math.floor(Number(organic) * credibility(from)));
    creditedTotal += credited;

    const payeeAgent = attribution.get(p.payee);
    if (payeeAgent) {
      const acc = accumulators.get(payeeAgent) as AgentAccumulator;
      acc.rawIn += p.usdMicros;
      if (self) {
        acc.selfDealing += p.usdMicros;
      } else {
        acc.payerWallets.add(p.payer);
        acc.organicIn += organic;
        acc.creditedIn += credited;
        acc.wash += wash;
        acc.incidental += incidental;
        acc.rawByPayer.set(from, (acc.rawByPayer.get(from) ?? 0n) + p.usdMicros);
        const prevFirst = acc.firstPaymentByPayer.get(from);
        if (prevFirst === undefined || p.blockTime < prevFirst) {
          acc.firstPaymentByPayer.set(from, p.blockTime);
        }
        if (credited > 0n) {
          const day = Math.floor(p.blockTime / DAY);
          acc.creditedByPayer.set(from, (acc.creditedByPayer.get(from) ?? 0n) + credited);
          let days = acc.daysByPayer.get(from);
          if (!days) {
            days = new Set();
            acc.daysByPayer.set(from, days);
          }
          days.add(day);
          acc.creditedDays.add(day);
          acc.creditedByDay.set(day, (acc.creditedByDay.get(day) ?? 0n) + credited);
          if (p.blockTime > input.asOf - DAY) acc.last24hCredited += credited;
        }
      }
    }

    const payerAgent = attribution.get(p.payer);
    if (payerAgent) {
      const acc = accumulators.get(payerAgent) as AgentAccumulator;
      acc.rawOut += p.usdMicros;
      if (self) acc.selfDealing += p.usdMicros;
      else acc.wash += wash;
    }
  }

  // ── 7. Scores ────────────────────────────────────────────────────────────────────────
  const cyclesByEntity = new Map<EntityId, CycleEvidence[]>();
  for (const c of cancellation.cycles) {
    for (const n of c.path) {
      let list = cyclesByEntity.get(n);
      if (!list) {
        list = [];
        cyclesByEntity.set(n, list);
      }
      list.push(c);
    }
  }

  const scores: AgentScore[] = agents.map((agent) => {
    const anchor = agent.wallets[0];
    const entity = anchor ? E(anchor) : agent.id;
    const acc = accumulators.get(agent.id) as AgentAccumulator;
    const core = computeAgentScore({ agent: agent.id, registry: agent.registry, entity }, acc, {
      methodology,
      asOf: input.asOf,
      trustLift: (pr.rank.get(entity) ?? 0) / prRef,
      firstSeen: (e) => profileFirstSeen.get(e),
      payeeDegree: (e) => graph.successors(e).length,
    });
    const cycles = [...(cyclesByEntity.get(entity) ?? [])]
      .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
      .slice(0, 5);
    return {
      ...core,
      evidence: {
        linkedWallets: [...(entities.members.get(entity) ?? [])].slice(0, 50),
        mergeLinks: [...(entities.mergeEvidence.get(entity) ?? [])].slice(0, 50),
        cycles,
      },
    };
  });

  // ── 8. Commitments ───────────────────────────────────────────────────────────────────
  const leafHashes = scores.map((s) =>
    hashLeaf({
      agent: s.agent,
      registry: REGISTRY_CODE[s.registry],
      epoch: input.epoch,
      score: s.score,
      confidence: s.confidence,
      flags: s.flags,
      washRatioBps: s.washRatioBps,
      uniquePayers: s.uniquePayers,
      organicVolume: s.organicVolumeMicros,
    }),
  );
  const tree = buildMerkleTree(leafHashes);
  const proofs = new Map<Address, string[]>();
  scores.forEach((s, i) => {
    proofs.set(s.agent, getProof(tree, i).map(toHex));
  });

  // ── 9. Ecosystem stats ───────────────────────────────────────────────────────────────
  const byRail: EcosystemStats["byRail"] = {
    x402_exact: { count: 0, rawVolumeMicros: 0n },
    payment_channel: { count: 0, rawVolumeMicros: 0n },
    direct_transfer: { count: 0, rawVolumeMicros: 0n },
  };
  let rawVolume = 0n;
  const payers = new Set<Address>();
  const payees = new Set<Address>();
  for (const p of payments) {
    rawVolume += p.usdMicros;
    byRail[p.rail].count++;
    byRail[p.rail].rawVolumeMicros += p.usdMicros;
    payers.add(p.payer);
    payees.add(p.payee);
  }
  const washTotal = sumValues(washByEdge);
  const incidentalTotal = sumValues(incidentalByEdge);
  const organicTotal = rawVolume - selfDealingTotal - washTotal - incidentalTotal;

  return {
    epoch: input.epoch,
    asOf: input.asOf,
    windowStart,
    methodologyVersion: methodology.version,
    methodologyHash: methodologyHash(methodology),
    inputsHash: inputsHash(input, payments),
    merkleRoot: toHex(tree.root),
    scores,
    proofs,
    stats: {
      paymentCount: payments.length,
      rawVolumeMicros: rawVolume,
      selfDealingMicros: selfDealingTotal,
      washCircularMicros: washTotal,
      incidentalCircularMicros: incidentalTotal,
      organicVolumeMicros: organicTotal,
      creditedVolumeMicros: creditedTotal,
      organicShareBps: rawVolume > 0n ? Number((organicTotal * 10_000n) / rawVolume) : 0,
      byRail,
      uniquePayerWallets: payers.size,
      uniquePayeeWallets: payees.size,
      entityCount: entityNodes.length,
    },
    diagnostics: {
      cyclesFound: cancellation.cycles.length,
      cyclesTruncated: cancellation.truncated,
      pageRankIterations: pr.iterations,
      pageRankConverged: pr.converged,
      hubs: entities.hubs,
    },
  };
}

function dedupeAgents(agents: readonly AgentIdentity[]): AgentIdentity[] {
  const byId = new Map<Address, AgentIdentity>();
  for (const a of agents) if (!byId.has(a.id)) byId.set(a.id, a);
  return [...byId.values()];
}

/**
 * Map each wallet to exactly one agent so inflow is never double counted. Earlier positions
 * in `wallets` win (providers list the operational wallet first); ties go to the smallest
 * agent id.
 */
function attributeWallets(agents: readonly AgentIdentity[]): Map<Address, Address> {
  const best = new Map<Address, { agent: Address; pos: number }>();
  for (const a of agents) {
    a.wallets.forEach((w, pos) => {
      const cur = best.get(w);
      if (!cur || pos < cur.pos || (pos === cur.pos && a.id < cur.agent)) {
        best.set(w, { agent: a.id, pos });
      }
    });
  }
  return new Map([...best].map(([w, v]) => [w, v.agent]));
}

function registryLinks(agents: readonly AgentIdentity[]): WalletLink[] {
  const anchorOf = new Map<Address, Address>();
  for (const a of agents) {
    const anchor = a.owner ?? a.wallets[0];
    if (anchor) anchorOf.set(a.id, anchor);
  }
  const out: WalletLink[] = [];
  for (const a of agents) {
    const anchor = anchorOf.get(a.id);
    if (!anchor) continue;
    for (const w of a.wallets) {
      if (w === anchor) continue;
      out.push({
        from: w,
        to: anchor,
        kind: a.owner ? "registry_owner" : "registry_agent_wallet",
        evidence: a.id,
      });
    }
    if (a.creator && a.creator !== anchor) {
      out.push({ from: anchor, to: a.creator, kind: "registry_creator", evidence: a.id });
    }
    const parentAnchor = a.parent ? anchorOf.get(a.parent) : undefined;
    if (parentAnchor && parentAnchor !== anchor) {
      out.push({ from: anchor, to: parentAnchor, kind: "registry_parent", evidence: a.id });
    }
  }
  return out;
}

function fundingLinks(wallets: readonly WalletProfile[]): WalletLink[] {
  return wallets
    .filter((w) => w.firstFunder && w.firstFunder !== w.address)
    .map((w) => ({ from: w.address, to: w.firstFunder as Address, kind: "funded_by" as const }));
}

/**
 * `profileFirstSeen` only uses resolved wallet profiles. Freshness checks need it, because a
 * wallet with no resolved profile would otherwise look new at its first in-window payment.
 * `firstSeen` also falls back to in-window activity and is used for seed age, where
 * underestimating age is the safe direction.
 */
function entityFirstSeen(
  wallets: readonly WalletProfile[],
  payments: readonly Payment[],
  E: (a: Address) => EntityId,
): { firstSeen: Map<EntityId, number>; profileFirstSeen: Map<EntityId, number> } {
  const firstSeen = new Map<EntityId, number>();
  const profileFirstSeen = new Map<EntityId, number>();
  const bump = (m: Map<EntityId, number>, a: Address, t: number) => {
    const e = E(a);
    const cur = m.get(e);
    if (cur === undefined || t < cur) m.set(e, t);
  };
  for (const w of wallets) {
    if (w.firstSeenAt === undefined) continue;
    bump(profileFirstSeen, w.address, w.firstSeenAt);
    bump(firstSeen, w.address, w.firstSeenAt);
  }
  for (const p of payments) {
    bump(firstSeen, p.payer, p.blockTime);
    bump(firstSeen, p.payee, p.blockTime);
  }
  return { firstSeen, profileFirstSeen };
}

function transform(micros: bigint, kind: Methodology["trust"]["edgeTransform"]): number {
  const usd = Number(micros) / 1_000_000;
  if (kind === "sqrt") return Math.sqrt(usd);
  if (kind === "log") return Math.log1p(usd);
  return usd;
}

function sumValues(m: ReadonlyMap<string, bigint>): bigint {
  let s = 0n;
  for (const v of m.values()) s += v;
  return s;
}

/**
 * Streaming hash over every input that affects the output, so the hash can be checked
 * against the indexed dataset without holding it all as one string.
 */
function inputsHash(input: EpochInput, windowPayments: readonly Payment[]): string {
  const h = sha256.create();
  const line = (s: string) => h.update(utf8ToBytes(`${s}\n`));
  line(`epoch:${input.epoch}|asOf:${input.asOf}`);
  for (const p of windowPayments)
    line(`p|${p.id}|${p.payer}|${p.payee}|${p.usdMicros}|${p.blockTime}`);
  for (const l of [...input.links].map((l) => `l|${l.kind}|${l.from}|${l.to}`).sort()) line(l);
  for (const w of [...input.wallets]
    .map((w) => `w|${w.address}|${w.firstSeenAt ?? ""}|${w.firstFunder ?? ""}`)
    .sort())
    line(w);
  for (const a of [...input.agents]
    .map(
      (a) =>
        `a|${a.registry}|${a.id}|${a.wallets.join(",")}|${a.owner ?? ""}|${a.creator ?? ""}|${a.parent ?? ""}`,
    )
    .sort())
    line(a);
  for (const i of [...(input.infrastructure ?? [])].sort()) line(`i|${i}`);
  return bytesToHex(h.digest());
}
