import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const registryKind = pgEnum("registry_kind", ["8004", "sati", "wallet"]);
export const paymentRail = pgEnum("payment_rail", [
  "x402_exact",
  "payment_channel",
  "direct_transfer",
]);
export const linkKind = pgEnum("link_kind", [
  "registry_owner",
  "registry_agent_wallet",
  "registry_creator",
  "registry_parent",
  "funded_by",
  "fee_payer",
  "channel_rent_payer",
  "close_destination",
]);
export const profileStatus = pgEnum("profile_status", ["pending", "resolved", "unresolvable"]);
export const epochStatus = pgEnum("epoch_status", [
  "computed",
  "publishing",
  "published",
  "failed",
]);

/** Agent identities synced from registries (or synthesised for raw payee wallets). */
export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  registry: registryKind("registry").notNull(),
  wallets: text("wallets").array().notNull(),
  owner: text("owner"),
  creator: text("creator"),
  parent: text("parent"),
  agentUri: text("agent_uri"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Classified settlements. One row per (signature, instruction path). */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    signature: text("signature").notNull(),
    slot: bigint("slot", { mode: "number" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    rail: paymentRail("rail").notNull(),
    payer: text("payer").notNull(),
    payee: text("payee").notNull(),
    mint: text("mint").notNull(),
    // u64 token amounts overflow int8, so store them as numeric.
    amount: numeric("amount", { precision: 20, scale: 0, mode: "bigint" }).notNull(),
    usdMicros: bigint("usd_micros", { mode: "bigint" }).notNull(),
    feePayer: text("fee_payer"),
    facilitator: text("facilitator"),
    memo: text("memo"),
  },
  (t) => [
    index("payments_block_time_idx").on(t.blockTime),
    index("payments_payee_time_idx").on(t.payee, t.blockTime),
    index("payments_payer_time_idx").on(t.payer, t.blockTime),
  ],
);

/** Evidence that two wallets share a controller. */
export const walletLinks = pgTable(
  "wallet_links",
  {
    from: text("from").notNull(),
    to: text("to").notNull(),
    kind: linkKind("kind").notNull(),
    evidence: text("evidence"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.from, t.to, t.kind] }), index("wallet_links_to_idx").on(t.to)],
);

/** Funding origin and age per wallet, resolved lazily by the indexer's funding worker. */
export const walletProfiles = pgTable(
  "wallet_profiles",
  {
    address: text("address").primaryKey(),
    status: profileStatus("status").notNull().default("pending"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    firstFunder: text("first_funder"),
    fundingSignature: text("funding_signature"),
    note: text("note"),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wallet_profiles_status_idx").on(t.status)],
);

/** Per-stream resume points (newest signature processed per watched address). */
export const ingestCursors = pgTable("ingest_cursors", {
  stream: text("stream").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: bigint("last_slot", { mode: "number" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const epochs = pgTable("epochs", {
  epoch: bigint("epoch", { mode: "bigint" }).primaryKey(),
  status: epochStatus("status").notNull().default("computed"),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  methodologyVersion: integer("methodology_version").notNull(),
  methodologyHash: text("methodology_hash").notNull(),
  inputsHash: text("inputs_hash").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  agentCount: integer("agent_count").notNull(),
  stats: jsonb("stats").notNull(),
  diagnostics: jsonb("diagnostics").notNull(),
  publishSignature: text("publish_signature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const scores = pgTable(
  "scores",
  {
    epoch: bigint("epoch", { mode: "bigint" }).notNull(),
    agentId: text("agent_id").notNull(),
    registry: registryKind("registry").notNull(),
    entity: text("entity").notNull(),
    score: integer("score").notNull(),
    confidence: integer("confidence").notNull(),
    flags: integer("flags").notNull(),
    washRatioBps: integer("wash_ratio_bps").notNull(),
    uniquePayers: integer("unique_payers").notNull(),
    organicVolumeMicros: bigint("organic_volume_micros", { mode: "bigint" }).notNull(),
    rawVolumeMicros: bigint("raw_volume_micros", { mode: "bigint" }).notNull(),
    components: jsonb("components").notNull(),
    features: jsonb("features").notNull(),
    evidence: jsonb("evidence").notNull(),
    proof: text("proof").array().notNull(),
    /** Set once this row has been written onchain by the publisher. */
    publishSignature: text("publish_signature"),
  },
  (t) => [
    primaryKey({ columns: [t.epoch, t.agentId] }),
    index("scores_agent_idx").on(t.agentId, t.epoch),
  ],
);
