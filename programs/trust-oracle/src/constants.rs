use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const EPOCH_SEED: &[u8] = b"epoch";

#[constant]
pub const SCORE_SEED: &[u8] = b"score";

pub const CONFIG_VERSION: u8 = 1;
pub const EPOCH_VERSION: u8 = 1;
pub const AGENT_SCORE_VERSION: u8 = trust_oracle_interface::AGENT_SCORE_VERSION;

#[constant]
pub const MAX_SCORE: u16 = trust_oracle_interface::MAX_SCORE;

#[constant]
pub const MAX_BPS: u16 = trust_oracle_interface::MAX_BPS;

/// Highest registry code accepted (see `trust_oracle_interface::registry`).
pub const MAX_REGISTRY: u8 = trust_oracle_interface::registry::WALLET;

/// 2^32 leaves is far beyond any realistic epoch; bounds compute for proof checks.
pub const MAX_PROOF_LEN: usize = 32;

/// Allowed clock skew when an epoch window ends slightly in the future.
pub const MAX_WINDOW_SKEW_SECS: i64 = 3_600;
