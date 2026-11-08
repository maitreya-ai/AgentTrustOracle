import { sha256 } from "@ato/core";
import type { Address } from "@solana/kit";

/** Kept in sync with declare_id! by `bun run program:keys`. */
export const TRUST_ORACLE_PROGRAM_ID = "2amJRdRNf4XyNGYH2gc4sQyvmKBQVN62pieHmSvMo3HJ" as Address;

export const SEEDS = {
  config: "config",
  epoch: "epoch",
  score: "score",
} as const;

export const AGENT_SCORE_SIZE = 128;
export const AGENT_SCORE_VERSION = 1;
export const MAX_SCORE = 1000;
export const MAX_BPS = 10_000;

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Anchor account discriminator: sha256("account:<Name>")[..8]. */
export const accountDiscriminator = (name: string) => sha256(utf8(`account:${name}`)).slice(0, 8);

/** Anchor instruction discriminator: sha256("global:<snake_name>")[..8]. */
export const instructionDiscriminator = (name: string) =>
  sha256(utf8(`global:${name}`)).slice(0, 8);

export const DISCRIMINATORS = {
  accounts: {
    OracleConfig: accountDiscriminator("OracleConfig"),
    ScoreEpoch: accountDiscriminator("ScoreEpoch"),
    AgentScore: accountDiscriminator("AgentScore"),
  },
  instructions: {
    initialize: instructionDiscriminator("initialize"),
    update_config: instructionDiscriminator("update_config"),
    propose_admin: instructionDiscriminator("propose_admin"),
    accept_admin: instructionDiscriminator("accept_admin"),
    publish_epoch: instructionDiscriminator("publish_epoch"),
    upsert_score: instructionDiscriminator("upsert_score"),
    close_score: instructionDiscriminator("close_score"),
    assert_trust: instructionDiscriminator("assert_trust"),
    verify_score_proof: instructionDiscriminator("verify_score_proof"),
  },
} as const;
