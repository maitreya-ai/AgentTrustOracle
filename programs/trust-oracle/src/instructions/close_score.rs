use anchor_lang::prelude::*;

use crate::{constants::*, error::OracleError, events::ScoreClosed, state::*};

#[derive(Accounts)]
pub struct CloseScore<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ OracleError::Unauthorized)]
    pub config: Account<'info, OracleConfig>,
    #[account(
        mut,
        close = admin,
        seeds = [SCORE_SEED, agent_score.agent.as_ref()],
        bump = agent_score.bump
    )]
    pub agent_score: Account<'info, AgentScore>,
}

/// Reclaim rent for an agent that left the registry. Its history stays in the epoch roots.
pub fn handle_close_score(ctx: Context<CloseScore>) -> Result<()> {
    ctx.accounts.config.score_accounts = ctx.accounts.config.score_accounts.saturating_sub(1);
    emit!(ScoreClosed {
        agent: ctx.accounts.agent_score.agent
    });
    Ok(())
}
