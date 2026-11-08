use anchor_lang::prelude::*;

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub publisher: Pubkey,
    pub paused: bool,
    pub methodology_version: u16,
}

#[event]
pub struct AdminProposed {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub previous: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct EpochPublished {
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub methodology_hash: [u8; 32],
    pub inputs_hash: [u8; 32],
    pub agent_count: u32,
    pub publisher: Pubkey,
}

#[event]
pub struct ScoreUpdated {
    pub agent: Pubkey,
    pub epoch: u64,
    pub score: u16,
    pub prev_score: u16,
    pub confidence: u16,
    pub flags: u32,
}

#[event]
pub struct ScoreClosed {
    pub agent: Pubkey,
}
