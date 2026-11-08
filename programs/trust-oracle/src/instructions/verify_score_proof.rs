use anchor_lang::prelude::*;
use trust_oracle_interface::{encode_leaf, merkle_root_from_proof, ScoreLeaf};

use crate::{constants::*, error::OracleError, state::*};

#[derive(Accounts)]
pub struct VerifyScoreProof<'info> {
    #[account(seeds = [EPOCH_SEED, epoch.epoch.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, ScoreEpoch>,
}

/// Verify an agent's score against an epoch's Merkle root. This covers any agent in the
/// epoch, including those without a materialised `AgentScore` account, using a proof from
/// the API (`GET /v1/agents/:id/proof`).
pub fn handle_verify_score_proof(
    ctx: Context<VerifyScoreProof>,
    leaf: ScoreLeafArgs,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    require!(proof.len() <= MAX_PROOF_LEN, OracleError::ProofTooLong);
    require!(
        leaf.epoch == ctx.accounts.epoch.epoch,
        OracleError::EpochMismatch
    );
    let root = compute_root(&leaf.into(), &proof);
    require!(
        root == ctx.accounts.epoch.merkle_root,
        OracleError::InvalidProof
    );
    Ok(())
}

pub fn compute_root(leaf: &ScoreLeaf, proof: &[[u8; 32]]) -> [u8; 32] {
    let sha = |bytes: &[u8]| solana_sha256_hasher::hashv(&[bytes]).to_bytes();
    merkle_root_from_proof(sha(&encode_leaf(leaf)), proof, sha)
}
