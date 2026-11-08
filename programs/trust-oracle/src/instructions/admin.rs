use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::OracleError,
    events::{AdminProposed, AdminTransferred},
    state::*,
};

#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ OracleError::Unauthorized)]
    pub config: Account<'info, OracleConfig>,
}

/// Step 1 of 2: nominate a new admin. Nothing changes until they accept.
pub fn handle_propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.pending_admin = Some(new_admin);
    emit!(AdminProposed {
        admin: config.admin,
        pending_admin: new_admin
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin == Some(new_admin.key()) @ OracleError::NotPendingAdmin
    )]
    pub config: Account<'info, OracleConfig>,
}

/// Step 2 of 2: the nominee proves key control and takes over.
pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let previous = config.admin;
    config.admin = ctx.accounts.new_admin.key();
    config.pending_admin = None;
    emit!(AdminTransferred {
        previous,
        admin: config.admin
    });
    Ok(())
}
