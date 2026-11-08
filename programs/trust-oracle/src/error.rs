use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Oracle is paused")]
    Paused,
    #[msg("Epoch must be exactly latest_epoch + 1")]
    EpochOutOfOrder,
    #[msg("Invalid epoch window")]
    InvalidWindow,
    #[msg("Score out of range (max 1000)")]
    InvalidScore,
    #[msg("Basis points out of range (max 10000)")]
    InvalidBps,
    #[msg("Unknown registry kind")]
    InvalidRegistry,
    #[msg("Cannot overwrite a score with an older epoch")]
    StaleEpoch,
    #[msg("Signer is not the pending admin")]
    NotPendingAdmin,
    #[msg("Agent score is below the policy minimum")]
    ScoreTooLow,
    #[msg("Agent confidence is below the policy minimum")]
    ConfidenceTooLow,
    #[msg("Agent score is older than the policy allows")]
    StaleScore,
    #[msg("Agent carries a flag the policy forbids")]
    ForbiddenFlags,
    #[msg("Merkle proof does not match the epoch root")]
    InvalidProof,
    #[msg("Merkle proof is too long")]
    ProofTooLong,
    #[msg("Leaf epoch does not match the epoch account")]
    EpochMismatch,
}

impl From<trust_oracle_interface::PolicyViolation> for OracleError {
    fn from(v: trust_oracle_interface::PolicyViolation) -> Self {
        use trust_oracle_interface::PolicyViolation::*;
        match v {
            ScoreTooLow => OracleError::ScoreTooLow,
            ConfidenceTooLow => OracleError::ConfidenceTooLow,
            Stale => OracleError::StaleScore,
            ForbiddenFlags => OracleError::ForbiddenFlags,
        }
    }
}
