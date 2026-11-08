use anchor_lang::prelude::*;

use crate::{constants::*, error::OracleError, events::ScoreUpdated, state::*};

#[derive(Accounts)]
#[instruction(args: UpsertScoreArgs)]
pub struct UpsertScore<'info> {
    #[account(mut)]
    pub publisher: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = publisher @ OracleError::Unauthorized,
        constraint = !config.paused @ OracleError::Paused
    )]
    pub config: Account<'info, OracleConfig>,
    /// Scores can only be written against the latest published epoch.
    #[account(seeds = [EPOCH_SEED, config.latest_epoch.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, ScoreEpoch>,
    #[account(
        init_if_needed,
        payer = publisher,
        space = AgentScore::SPACE,
        seeds = [SCORE_SEED, args.agent.as_ref()],
        bump
    )]
    pub agent_score: Account<'info, AgentScore>,
    pub system_program: Program<'info, System>,
}

/// Materialise (or refresh) one agent's score for the latest epoch. The values must equal
/// the agent's leaf in `epoch.merkle_root`. Anyone can check that offchain, or onchain with
/// `verify_score_proof`.
pub fn handle_upsert_score(ctx: Context<UpsertScore>, args: UpsertScoreArgs) -> Result<()> {
    require!(args.score <= MAX_SCORE, OracleError::InvalidScore);
    require!(args.confidence <= MAX_BPS, OracleError::InvalidBps);
    require!(args.wash_ratio_bps <= MAX_BPS, OracleError::InvalidBps);
    require!(args.registry <= MAX_REGISTRY, OracleError::InvalidRegistry);

    let clock = Clock::get()?;
    let epoch = &ctx.accounts.epoch;
    let score = &mut ctx.accounts.agent_score;
    let is_new = score.version == 0;

    if !is_new {
        require!(epoch.epoch >= score.epoch, OracleError::StaleEpoch);
        // prev_score tracks the last *epoch's* value, not same-epoch corrections.
        if epoch.epoch > score.epoch {
            score.prev_score = score.score;
        }
    }

    score.version = AGENT_SCORE_VERSION;
    score.bump = ctx.bumps.agent_score;
    score.registry = args.registry;
    score.agent = args.agent;
    score.score = args.score;
    score.confidence = args.confidence;
    score.flags = args.flags;
    score.wash_ratio_bps = args.wash_ratio_bps;
    score.unique_payers = args.unique_payers;
    score.organic_volume = args.organic_volume;
    score.raw_volume = args.raw_volume;
    score.epoch = epoch.epoch;
    score.updated_slot = clock.slot;
    score.updated_at = clock.unix_timestamp;
    score.methodology_version = epoch.methodology_version;

    if is_new {
        ctx.accounts.config.score_accounts = ctx.accounts.config.score_accounts.saturating_add(1);
    }

    emit!(ScoreUpdated {
        agent: args.agent,
        epoch: epoch.epoch,
        score: args.score,
        prev_score: score.prev_score,
        confidence: args.confidence,
        flags: args.flags,
    });
    Ok(())
}
