use anchor_lang::prelude::*;
use trust_oracle_interface::{AgentScoreView, ScoreLeaf, TrustPolicy};

/// Global oracle configuration. PDA: `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct OracleConfig {
    pub version: u8,
    pub bump: u8,
    pub paused: bool,
    /// Governance key (use a Squads multisig in production).
    pub admin: Pubkey,
    /// Two-step admin handover target.
    pub pending_admin: Option<Pubkey>,
    /// Hot key allowed to publish epochs and scores. Rotatable by `admin`.
    pub publisher: Pubkey,
    pub methodology_version: u16,
    pub latest_epoch: u64,
    pub latest_epoch_at: i64,
    /// Live `AgentScore` accounts.
    pub score_accounts: u64,
    pub reserved: [u8; 64],
}

/// One published scoring epoch. PDA: `["epoch", epoch u64 LE]`.
///
/// The Merkle root commits to every agent's score in the epoch, including agents with no
/// `AgentScore` account. `methodology_hash` and `inputs_hash` let anyone re-run the
/// open-source pipeline on the indexed data and check that they get the same root.
#[account]
#[derive(InitSpace)]
pub struct ScoreEpoch {
    pub version: u8,
    pub bump: u8,
    pub methodology_version: u16,
    pub agent_count: u32,
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub methodology_hash: [u8; 32],
    pub inputs_hash: [u8; 32],
    pub window_start: i64,
    pub window_end: i64,
    pub published_slot: u64,
    pub published_at: i64,
    pub publisher: Pubkey,
    pub reserved: [u8; 32],
}

/// Materialised score for one agent. PDA: `["score", agent]`.
///
/// Fixed-size, so the borsh layout has stable offsets. `trust_oracle_interface` parses it
/// without Anchor. Do not reorder fields: append in `reserved` and bump `version`.
#[account]
#[derive(InitSpace)]
pub struct AgentScore {
    pub version: u8,
    pub bump: u8,
    pub registry: u8,
    pub agent: Pubkey,
    pub score: u16,
    pub confidence: u16,
    pub flags: u32,
    pub wash_ratio_bps: u16,
    pub unique_payers: u32,
    pub organic_volume: u64,
    pub raw_volume: u64,
    pub epoch: u64,
    pub updated_slot: u64,
    pub updated_at: i64,
    pub prev_score: u16,
    pub methodology_version: u16,
    pub reserved: [u8; 27],
}

impl AgentScore {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    pub fn view(&self) -> AgentScoreView {
        AgentScoreView {
            version: self.version,
            bump: self.bump,
            registry: self.registry,
            agent: self.agent.to_bytes(),
            score: self.score,
            confidence: self.confidence,
            flags: self.flags,
            wash_ratio_bps: self.wash_ratio_bps,
            unique_payers: self.unique_payers,
            organic_volume: self.organic_volume,
            raw_volume: self.raw_volume,
            epoch: self.epoch,
            updated_slot: self.updated_slot,
            updated_at: self.updated_at,
            prev_score: self.prev_score,
            methodology_version: self.methodology_version,
        }
    }
}

// ── Instruction args ──────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct InitializeArgs {
    pub publisher: Pubkey,
    pub methodology_version: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UpdateConfigArgs {
    pub publisher: Option<Pubkey>,
    pub paused: Option<bool>,
    pub methodology_version: Option<u16>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PublishEpochArgs {
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub methodology_hash: [u8; 32],
    pub inputs_hash: [u8; 32],
    pub window_start: i64,
    pub window_end: i64,
    pub agent_count: u32,
    pub methodology_version: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct UpsertScoreArgs {
    pub agent: Pubkey,
    pub registry: u8,
    pub score: u16,
    pub confidence: u16,
    pub flags: u32,
    pub wash_ratio_bps: u16,
    pub unique_payers: u32,
    pub organic_volume: u64,
    pub raw_volume: u64,
}

/// Borsh mirror of [`trust_oracle_interface::TrustPolicy`].
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TrustPolicyArgs {
    pub min_score: u16,
    pub min_confidence: u16,
    pub max_age_slots: u64,
    pub forbidden_flags: u32,
}

impl From<TrustPolicyArgs> for TrustPolicy {
    fn from(p: TrustPolicyArgs) -> Self {
        TrustPolicy {
            min_score: p.min_score,
            min_confidence: p.min_confidence,
            max_age_slots: p.max_age_slots,
            forbidden_flags: p.forbidden_flags,
        }
    }
}

/// Borsh mirror of [`trust_oracle_interface::ScoreLeaf`].
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScoreLeafArgs {
    pub agent: Pubkey,
    pub registry: u8,
    pub epoch: u64,
    pub score: u16,
    pub confidence: u16,
    pub flags: u32,
    pub wash_ratio_bps: u16,
    pub unique_payers: u32,
    pub organic_volume: u64,
}

impl From<ScoreLeafArgs> for ScoreLeaf {
    fn from(l: ScoreLeafArgs) -> Self {
        ScoreLeaf {
            agent: l.agent.to_bytes(),
            registry: l.registry,
            epoch: l.epoch,
            score: l.score,
            confidence: l.confidence,
            flags: l.flags,
            wash_ratio_bps: l.wash_ratio_bps,
            unique_payers: l.unique_payers,
            organic_volume: l.organic_volume,
        }
    }
}
