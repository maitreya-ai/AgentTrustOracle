//! Example: a protocol that only lets *trusted, registered* agents act.
//!
//! Two account reads, no CPI:
//!  1. the agent's 8004 `AgentAccount` proves the signer IS the agent;
//!  2. the oracle's `AgentScore` proves the agent is trusted right now.
//!
//! Swap `gated_action`'s body for whatever you are protecting: an undercollateralised
//! credit line, an agents-only liquidity pool, a job board that pays out on completion.
use anchor_lang::prelude::*;
use trust_oracle_interface::{erc8004, flags, load_checked, TrustPolicy};

declare_id!("FPjHXfRP2fP7mmAf2BcXimwozdS3gAeaykvp4zHumhda");

/// What this protocol demands of an agent.
pub const POLICY: TrustPolicy = TrustPolicy {
    min_score: 650,
    min_confidence: 6_000,
    max_age_slots: TrustPolicy::TWO_DAYS_SLOTS,
    forbidden_flags: flags::PENALISING | flags::MANUAL_REVIEW,
};

#[program]
pub mod trust_gated_vault {
    use super::*;

    pub fn gated_action(ctx: Context<GatedAction>) -> Result<()> {
        // 1. The signer controls a registered 8004 agent.
        let agent_info = &ctx.accounts.agent_account;
        let agent =
            erc8004::parse_agent(&agent_info.owner.to_bytes(), &agent_info.try_borrow_data()?)
                .ok_or(GateError::NotARegisteredAgent)?;
        require!(
            agent.is_controlled_by(&ctx.accounts.agent_signer.key().to_bytes()),
            GateError::SignerIsNotAgent
        );

        // 2. The oracle vouches for that agent under our policy.
        let score_info = &ctx.accounts.agent_score;
        let score = load_checked(
            &score_info.owner.to_bytes(),
            &score_info.try_borrow_data()?,
            &agent.asset,
        )
        .map_err(|_| GateError::InvalidScoreAccount)?;
        POLICY
            .check(&score, Clock::get()?.slot)
            .map_err(|_| GateError::AgentNotTrusted)?;

        msg!(
            "agent trusted: score={} confidence={}bps",
            score.score,
            score.confidence
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct GatedAction<'info> {
    pub agent_signer: Signer<'info>,
    /// CHECK: owner, discriminator and layout are validated by `erc8004::parse_agent`.
    pub agent_account: UncheckedAccount<'info>,
    /// CHECK: owner, discriminator, size and agent id are validated by `load_checked`.
    pub agent_score: UncheckedAccount<'info>,
}

#[error_code]
pub enum GateError {
    #[msg("Account is not an 8004 AgentAccount")]
    NotARegisteredAgent,
    #[msg("Signer does not control this agent")]
    SignerIsNotAgent,
    #[msg("Account is not a valid oracle score for this agent")]
    InvalidScoreAccount,
    #[msg("Agent does not meet the trust policy")]
    AgentNotTrusted,
}
