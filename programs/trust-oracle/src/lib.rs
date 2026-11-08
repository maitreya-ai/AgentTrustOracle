//! # Agent Trust Oracle
//!
//! Payment-grounded reputation for Solana agents. An offchain pipeline indexes x402 and
//! payment-channel settlements, strips self-dealing and wash trading, and scores agents.
//! This program is where those scores become a public good that other programs can compose
//! with:
//!
//! - `ScoreEpoch` commits each epoch (Merkle root, methodology hash, inputs hash) so any
//!   score can be independently reproduced and verified.
//! - `AgentScore` materialises per-agent scores that any program can read with zero CPI via
//!   the `trust-oracle-interface` crate.
//! - `assert_trust` and `verify_score_proof` give CPI and guard-instruction entry points.
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2amJRdRNf4XyNGYH2gc4sQyvmKBQVN62pieHmSvMo3HJ");

#[program]
pub mod trust_oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, args)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        instructions::update_config::handle_update_config(ctx, args)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::handle_propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::handle_accept_admin(ctx)
    }

    pub fn publish_epoch(ctx: Context<PublishEpoch>, args: PublishEpochArgs) -> Result<()> {
        instructions::publish_epoch::handle_publish_epoch(ctx, args)
    }

    pub fn upsert_score(ctx: Context<UpsertScore>, args: UpsertScoreArgs) -> Result<()> {
        instructions::upsert_score::handle_upsert_score(ctx, args)
    }

    pub fn close_score(ctx: Context<CloseScore>) -> Result<()> {
        instructions::close_score::handle_close_score(ctx)
    }

    pub fn assert_trust(ctx: Context<AssertTrust>, policy: TrustPolicyArgs) -> Result<()> {
        instructions::assert_trust::handle_assert_trust(ctx, policy)
    }

    pub fn verify_score_proof(
        ctx: Context<VerifyScoreProof>,
        leaf: ScoreLeafArgs,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::verify_score_proof::handle_verify_score_proof(ctx, leaf, proof)
    }
}
