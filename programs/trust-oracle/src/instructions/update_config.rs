use anchor_lang::prelude::*;

use crate::{constants::*, error::OracleError, events::ConfigUpdated, state::*};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ OracleError::Unauthorized)]
    pub config: Account<'info, OracleConfig>,
}

/// Rotate the publisher key, pause/unpause, or bump the methodology version.
pub fn handle_update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(publisher) = args.publisher {
        config.publisher = publisher;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }
    if let Some(version) = args.methodology_version {
        config.methodology_version = version;
    }
    emit!(ConfigUpdated {
        admin: config.admin,
        publisher: config.publisher,
        paused: config.paused,
        methodology_version: config.methodology_version,
    });
    Ok(())
}
