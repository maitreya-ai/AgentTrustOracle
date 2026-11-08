use anchor_lang::prelude::*;
use trust_oracle_interface::TrustPolicy;

use crate::{constants::*, error::OracleError, state::*};

#[derive(Accounts)]
pub struct AssertTrust<'info> {
    #[account(seeds = [SCORE_SEED, agent_score.agent.as_ref()], bump = agent_score.bump)]
    pub agent_score: Account<'info, AgentScore>,
}

/// Fails unless the agent meets `policy`. Use it in two ways:
/// - **CPI** from an Anchor program (one line, no layout knowledge needed), or
/// - as a **guard instruction** in a client transaction: everything after it reverts
///   atomically if the counterparty's trust dropped since the tx was built.
///
/// For the cheapest path, skip the CPI and read the account with `trust_oracle_interface`.
pub fn handle_assert_trust(ctx: Context<AssertTrust>, policy: TrustPolicyArgs) -> Result<()> {
    let slot = Clock::get()?.slot;
    TrustPolicy::from(policy)
        .check(&ctx.accounts.agent_score.view(), slot)
        .map_err(|v| error!(OracleError::from(v)))
}
