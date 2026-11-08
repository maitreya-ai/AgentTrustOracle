use anchor_lang::prelude::*;

use crate::{
    constants::*, error::OracleError, events::ConfigUpdated, program::TrustOracle, state::*,
};

/// One-time setup. Only the program's upgrade authority can call it, so nobody can
/// front-run initialisation after deploy.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + OracleConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, OracleConfig>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ OracleError::Unauthorized)]
    pub program: Program<'info, TrustOracle>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ OracleError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.version = CONFIG_VERSION;
    config.bump = ctx.bumps.config;
    config.paused = false;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = None;
    config.publisher = args.publisher;
    config.methodology_version = args.methodology_version;
    config.latest_epoch = 0;
    config.latest_epoch_at = 0;
    config.score_accounts = 0;
    emit!(ConfigUpdated {
        admin: config.admin,
        publisher: config.publisher,
        paused: config.paused,
        methodology_version: config.methodology_version,
    });
    Ok(())
}
