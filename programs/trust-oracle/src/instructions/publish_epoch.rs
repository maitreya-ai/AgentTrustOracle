use anchor_lang::prelude::*;

use crate::{constants::*, error::OracleError, events::EpochPublished, state::*};

#[derive(Accounts)]
#[instruction(args: PublishEpochArgs)]
pub struct PublishEpoch<'info> {
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
    #[account(
        init,
        payer = publisher,
        space = 8 + ScoreEpoch::INIT_SPACE,
        seeds = [EPOCH_SEED, args.epoch.to_le_bytes().as_ref()],
        bump
    )]
    pub epoch: Account<'info, ScoreEpoch>,
    pub system_program: Program<'info, System>,
}

/// Commit an epoch: Merkle root over all scores plus the methodology and input hashes needed
/// to reproduce it. Epochs are strictly sequential and immutable once written.
pub fn handle_publish_epoch(ctx: Context<PublishEpoch>, args: PublishEpochArgs) -> Result<()> {
    let clock = Clock::get()?;
    let config = &mut ctx.accounts.config;
    require!(
        args.epoch == config.latest_epoch + 1,
        OracleError::EpochOutOfOrder
    );
    require!(
        args.window_end > args.window_start,
        OracleError::InvalidWindow
    );
    require!(
        args.window_end <= clock.unix_timestamp + MAX_WINDOW_SKEW_SECS,
        OracleError::InvalidWindow
    );

    let epoch = &mut ctx.accounts.epoch;
    epoch.version = EPOCH_VERSION;
    epoch.bump = ctx.bumps.epoch;
    epoch.methodology_version = args.methodology_version;
    epoch.agent_count = args.agent_count;
    epoch.epoch = args.epoch;
    epoch.merkle_root = args.merkle_root;
    epoch.methodology_hash = args.methodology_hash;
    epoch.inputs_hash = args.inputs_hash;
    epoch.window_start = args.window_start;
    epoch.window_end = args.window_end;
    epoch.published_slot = clock.slot;
    epoch.published_at = clock.unix_timestamp;
    epoch.publisher = ctx.accounts.publisher.key();

    config.latest_epoch = args.epoch;
    config.latest_epoch_at = clock.unix_timestamp;
    config.methodology_version = args.methodology_version;

    emit!(EpochPublished {
        epoch: args.epoch,
        merkle_root: args.merkle_root,
        methodology_hash: args.methodology_hash,
        inputs_hash: args.inputs_hash,
        agent_count: args.agent_count,
        publisher: epoch.publisher,
    });
    Ok(())
}
