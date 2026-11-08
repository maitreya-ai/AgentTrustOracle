import type { Methodology } from "./methodology";
import type { Address, LinkKind, WalletLink } from "./types";

/** Entity id = lexicographically smallest member address (stable across runs). */
export type EntityId = string;

export interface EntityResolution {
  entityOf(address: Address): EntityId;
  members: ReadonlyMap<EntityId, readonly Address[]>;
  /** Links that actually merged wallets, grouped by resulting entity. */
  mergeEvidence: ReadonlyMap<EntityId, readonly WalletLink[]>;
  /** `kind:address` pairs ignored as shared infrastructure. */
  hubs: readonly string[];
  /** Entities that contain at least one soft-merged wallet. */
  softMerged: ReadonlySet<EntityId>;
}

class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: string): string {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
    return true;
  }

  keys(): IterableIterator<string> {
    return this.parent.keys();
  }
}

/**
 * Cluster wallets into controlling entities.
 *
 * Rules (methodology `entities`):
 *  1. Links touching `infrastructure` (facilitators, programs, treasuries) are ignored.
 *  2. For each link kind, an address linked to more than `hubFanout[kind]` distinct
 *     counterparts is a hub; its links of that kind are dropped.
 *  3. `hard` links merge. `soft` links merge only when both endpoints are under
 *     `softFanoutCap` for that kind.
 */
export function resolveEntities(
  addresses: Iterable<Address>,
  links: readonly WalletLink[],
  methodology: Methodology,
  infrastructure: ReadonlySet<Address> = new Set(),
): EntityResolution {
  const uf = new UnionFind();
  for (const a of addresses) uf.add(a);

  const usable = links.filter(
    (l) => l.from !== l.to && !infrastructure.has(l.from) && !infrastructure.has(l.to),
  );

  // Fan-out per (kind, address) over distinct counterparts.
  const fanout = new Map<string, Set<Address>>();
  for (const l of usable) {
    for (const [self, other] of [
      [l.from, l.to],
      [l.to, l.from],
    ] as const) {
      const key = `${l.kind}:${self}`;
      let set = fanout.get(key);
      if (!set) {
        set = new Set();
        fanout.set(key, set);
      }
      set.add(other);
    }
  }
  const fan = (kind: LinkKind, a: Address) => fanout.get(`${kind}:${a}`)?.size ?? 0;

  const hubs = new Set<string>();
  const merged: WalletLink[] = [];
  const softWallets = new Set<Address>();

  // Deterministic order: sort links before applying them.
  const ordered = [...usable].sort(
    (x, y) =>
      x.kind.localeCompare(y.kind) || x.from.localeCompare(y.from) || x.to.localeCompare(y.to),
  );

  for (const l of ordered) {
    const cap = methodology.entities.hubFanout[l.kind];
    const fromFan = fan(l.kind, l.from);
    const toFan = fan(l.kind, l.to);
    if (fromFan > cap) hubs.add(`${l.kind}:${l.from}`);
    if (toFan > cap) hubs.add(`${l.kind}:${l.to}`);
    if (fromFan > cap || toFan > cap) continue;

    const strength = methodology.entities.strength[l.kind];
    if (strength === "soft") {
      const softCap = methodology.entities.softFanoutCap;
      if (fromFan > softCap || toFan > softCap) continue;
    }
    if (uf.union(l.from, l.to)) merged.push(l);
    if (strength === "soft") {
      softWallets.add(l.from);
      softWallets.add(l.to);
    }
  }

  // Canonical ids: smallest member address.
  const groups = new Map<string, Address[]>();
  for (const a of uf.keys()) {
    const root = uf.find(a);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(a);
  }
  const canonical = new Map<string, EntityId>();
  const members = new Map<EntityId, Address[]>();
  for (const [root, group] of groups) {
    group.sort();
    const id = group[0] as EntityId;
    canonical.set(root, id);
    members.set(id, group);
  }

  const entityOf = (address: Address): EntityId => {
    const root = uf.find(address);
    const known = canonical.get(root);
    if (known) return known;
    // Address first seen after resolution: a singleton entity.
    canonical.set(root, address);
    members.set(address, [address]);
    return address;
  };

  const mergeEvidence = new Map<EntityId, WalletLink[]>();
  for (const l of merged) {
    const id = entityOf(l.from);
    let list = mergeEvidence.get(id);
    if (!list) {
      list = [];
      mergeEvidence.set(id, list);
    }
    list.push(l);
  }

  const softMerged = new Set<EntityId>();
  for (const w of softWallets) {
    const id = entityOf(w);
    if ((members.get(id)?.length ?? 1) > 1) softMerged.add(id);
  }

  return {
    entityOf,
    members,
    mergeEvidence,
    hubs: [...hubs].sort(),
    softMerged,
  };
}
