//! # trust-oracle-interface
//!
//! Read Agent Trust Oracle scores from any Solana program with **no CPI and no
//! dependencies**. Pass the agent's `AgentScore` account into your instruction and:
//!
//! ```ignore
//! use trust_oracle_interface::{load_checked, TrustPolicy};
//!
//! let view = load_checked(account.owner_bytes(), &account.data(), &agent_id)?;
//! TrustPolicy::STANDARD.check(&view, clock.slot)?;
//! ```
//!
//! `load_checked` verifies the owner program, discriminator, size and agent id. Only the
//! oracle program can create accounts it owns with this discriminator, and it derives them
//! at `["score", agent]`, so a consumer does not need to re-derive the PDA.
//!
//! The byte layout here is the contract. It is checked against the Anchor program's own
//! serialisation and the TypeScript SDK through `fixtures/`.
#![no_std]
#![forbid(unsafe_code)]

/// Agent Trust Oracle program id:
/// `2amJRdRNf4XyNGYH2gc4sQyvmKBQVN62pieHmSvMo3HJ`
#[rustfmt::skip]
pub const PROGRAM_ID: [u8; 32] = [23, 129, 241, 188, 9, 153, 198, 27, 143, 67, 45, 204, 100, 145, 164, 86, 233, 167, 244, 81, 84, 160, 80, 115, 113, 40, 142, 49, 41, 56, 120, 201];

pub const CONFIG_SEED: &[u8] = b"config";
pub const EPOCH_SEED: &[u8] = b"epoch";
pub const SCORE_SEED: &[u8] = b"score";

/// `sha256("account:AgentScore")[..8]` (Anchor's default account discriminator).
pub const AGENT_SCORE_DISCRIMINATOR: [u8; 8] = [244, 86, 12, 21, 5, 219, 141, 139];
/// Total account size, discriminator included.
pub const AGENT_SCORE_SIZE: usize = 128;
pub const AGENT_SCORE_VERSION: u8 = 1;

pub const MAX_SCORE: u16 = 1_000;
pub const MAX_BPS: u16 = 10_000;

/// Score flags (u32 bitmask). Mirrors `packages/core/src/flags.ts`.
pub mod flags {
    /// Penalising: share of flow to/from wallets the agent controls.
    pub const SELF_DEALING: u32 = 1 << 0;
    /// Penalising: share of flow in tight cycles (wash rings).
    pub const CIRCULAR_FLOW: u32 = 1 << 1;
    pub const FUNDING_CLUSTER: u32 = 1 << 2;
    pub const CONCENTRATED_PAYERS: u32 = 1 << 3;
    pub const FRESH_PAYERS: u32 = 1 << 4;
    pub const BURST: u32 = 1 << 5;
    pub const INSUFFICIENT_DATA: u32 = 1 << 6;
    pub const UNREGISTERED: u32 = 1 << 7;
    pub const MANUAL_REVIEW: u32 = 1 << 8;

    /// Flags that only an agent's own behaviour can set (third parties cannot grief them).
    pub const PENALISING: u32 = SELF_DEALING | CIRCULAR_FLOW;
}

/// Identity registry the agent id comes from.
pub mod registry {
    pub const ERC8004: u8 = 0;
    pub const SATI: u8 = 1;
    /// Raw payee wallet with no registry identity (cold-start coverage).
    pub const WALLET: u8 = 2;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseError {
    WrongOwner,
    WrongDiscriminator,
    WrongSize,
    UnsupportedVersion,
    AgentMismatch,
}

/// Borsh layout of `AgentScore` (all integers little-endian, no padding):
///
/// | offset | size | field                |
/// |-------:|-----:|----------------------|
/// |      0 |    8 | discriminator        |
/// |      8 |    1 | version              |
/// |      9 |    1 | bump                 |
/// |     10 |    1 | registry             |
/// |     11 |   32 | agent                |
/// |     43 |    2 | score                |
/// |     45 |    2 | confidence (bps)     |
/// |     47 |    4 | flags                |
/// |     51 |    2 | wash_ratio_bps       |
/// |     53 |    4 | unique_payers        |
/// |     57 |    8 | organic_volume (µUSD)|
/// |     65 |    8 | raw_volume (µUSD)    |
/// |     73 |    8 | epoch                |
/// |     81 |    8 | updated_slot         |
/// |     89 |    8 | updated_at (i64)     |
/// |     97 |    2 | prev_score           |
/// |     99 |    2 | methodology_version  |
/// |    101 |   27 | reserved             |
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentScoreView {
    pub version: u8,
    pub bump: u8,
    pub registry: u8,
    pub agent: [u8; 32],
    pub score: u16,
    pub confidence: u16,
    pub flags: u32,
    pub wash_ratio_bps: u16,
    pub unique_payers: u32,
    pub organic_volume: u64,
    pub raw_volume: u64,
    pub epoch: u64,
    pub updated_slot: u64,
    pub updated_at: i64,
    pub prev_score: u16,
    pub methodology_version: u16,
}

impl AgentScoreView {
    /// Parse account data (discriminator included). Does not check the owner. Use
    /// [`load_checked`] for untrusted accounts.
    pub fn parse(data: &[u8]) -> Result<Self, ParseError> {
        if data.len() < AGENT_SCORE_SIZE {
            return Err(ParseError::WrongSize);
        }
        if data[0..8] != AGENT_SCORE_DISCRIMINATOR {
            return Err(ParseError::WrongDiscriminator);
        }
        let version = data[8];
        if version == 0 || version > AGENT_SCORE_VERSION {
            return Err(ParseError::UnsupportedVersion);
        }
        let mut agent = [0u8; 32];
        agent.copy_from_slice(&data[11..43]);
        Ok(Self {
            version,
            bump: data[9],
            registry: data[10],
            agent,
            score: u16_at(data, 43),
            confidence: u16_at(data, 45),
            flags: u32_at(data, 47),
            wash_ratio_bps: u16_at(data, 51),
            unique_payers: u32_at(data, 53),
            organic_volume: u64_at(data, 57),
            raw_volume: u64_at(data, 65),
            epoch: u64_at(data, 73),
            updated_slot: u64_at(data, 81),
            updated_at: u64_at(data, 89) as i64,
            prev_score: u16_at(data, 97),
            methodology_version: u16_at(data, 99),
        })
    }

    #[inline]
    pub fn has_any_flag(&self, mask: u32) -> bool {
        self.flags & mask != 0
    }

    /// Slots since the oracle last wrote this score.
    #[inline]
    pub fn age_slots(&self, current_slot: u64) -> u64 {
        current_slot.saturating_sub(self.updated_slot)
    }
}

/// Validate an untrusted account and return its score for `expected_agent`.
pub fn load_checked(
    owner: &[u8; 32],
    data: &[u8],
    expected_agent: &[u8; 32],
) -> Result<AgentScoreView, ParseError> {
    if owner != &PROGRAM_ID {
        return Err(ParseError::WrongOwner);
    }
    let view = AgentScoreView::parse(data)?;
    if &view.agent != expected_agent {
        return Err(ParseError::AgentMismatch);
    }
    Ok(view)
}

/// What a consumer requires of an agent. All bounds are inclusive minimums except
/// `max_age_slots` (0 disables the staleness check) and `forbidden_flags`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TrustPolicy {
    pub min_score: u16,
    pub min_confidence: u16,
    pub max_age_slots: u64,
    pub forbidden_flags: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyViolation {
    ScoreTooLow,
    ConfidenceTooLow,
    Stale,
    ForbiddenFlags,
}

impl TrustPolicy {
    /// ~2 days at 400ms slots.
    pub const TWO_DAYS_SLOTS: u64 = 432_000;

    /// Reasonable default for gating value-bearing actions.
    pub const STANDARD: Self = Self {
        min_score: 600,
        min_confidence: 5_000,
        max_age_slots: Self::TWO_DAYS_SLOTS,
        forbidden_flags: flags::PENALISING,
    };

    /// Stricter default for credit/undercollateralised use.
    pub const STRICT: Self = Self {
        min_score: 800,
        min_confidence: 8_000,
        max_age_slots: Self::TWO_DAYS_SLOTS,
        forbidden_flags: flags::PENALISING | flags::FUNDING_CLUSTER | flags::MANUAL_REVIEW,
    };

    pub fn check(&self, s: &AgentScoreView, current_slot: u64) -> Result<(), PolicyViolation> {
        if s.has_any_flag(self.forbidden_flags) {
            return Err(PolicyViolation::ForbiddenFlags);
        }
        if s.score < self.min_score {
            return Err(PolicyViolation::ScoreTooLow);
        }
        if s.confidence < self.min_confidence {
            return Err(PolicyViolation::ConfidenceTooLow);
        }
        if self.max_age_slots > 0 && s.age_slots(current_slot) > self.max_age_slots {
            return Err(PolicyViolation::Stale);
        }
        Ok(())
    }
}

// ── Merkle commitments ────────────────────────────────────────────────────────────────────

pub const LEAF_PREFIX: u8 = 0x00;
pub const NODE_PREFIX: u8 = 0x01;
pub const LEAF_SIZE: usize = 64;

/// Fields committed per agent in an epoch's Merkle root.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScoreLeaf {
    pub agent: [u8; 32],
    pub registry: u8,
    pub epoch: u64,
    pub score: u16,
    pub confidence: u16,
    pub flags: u32,
    pub wash_ratio_bps: u16,
    pub unique_payers: u32,
    pub organic_volume: u64,
}

/// `0x00 || agent || registry || epoch || score || confidence || flags || wash_ratio_bps
/// || unique_payers || organic_volume`. Hash it with sha256 to get the leaf. Inner nodes
/// are `sha256(0x01 || min(a,b) || max(a,b))`.
pub fn encode_leaf(l: &ScoreLeaf) -> [u8; LEAF_SIZE] {
    let mut out = [0u8; LEAF_SIZE];
    out[0] = LEAF_PREFIX;
    out[1..33].copy_from_slice(&l.agent);
    out[33] = l.registry;
    out[34..42].copy_from_slice(&l.epoch.to_le_bytes());
    out[42..44].copy_from_slice(&l.score.to_le_bytes());
    out[44..46].copy_from_slice(&l.confidence.to_le_bytes());
    out[46..50].copy_from_slice(&l.flags.to_le_bytes());
    out[50..52].copy_from_slice(&l.wash_ratio_bps.to_le_bytes());
    out[52..56].copy_from_slice(&l.unique_payers.to_le_bytes());
    out[56..64].copy_from_slice(&l.organic_volume.to_le_bytes());
    out
}

/// Encode an inner node preimage with sorted children.
pub fn encode_node(a: &[u8; 32], b: &[u8; 32]) -> [u8; 65] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    let mut out = [0u8; 65];
    out[0] = NODE_PREFIX;
    out[1..33].copy_from_slice(lo);
    out[33..65].copy_from_slice(hi);
    out
}

/// Fold a proof with a caller-supplied sha256 (the `sol_sha256` syscall onchain), so the
/// crate stays dependency-free.
pub fn merkle_root_from_proof(
    leaf_hash: [u8; 32],
    proof: &[[u8; 32]],
    sha256: impl Fn(&[u8]) -> [u8; 32],
) -> [u8; 32] {
    let mut acc = leaf_hash;
    for sibling in proof {
        acc = sha256(&encode_node(&acc, sibling));
    }
    acc
}

// ── ERC-8004 Agent Registry (QuantuLabs) helpers ──────────────────────────────────────────

/// Read the fixed-offset fields of a QuantuLabs 8004 `AgentAccount` (PDA `["agent", asset]`),
/// so a program can check that a signer IS the agent before checking its score.
pub mod erc8004 {
    /// Mainnet `agent-registry-8004`: `8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ`
    pub const PROGRAM_ID_MAINNET: [u8; 32] = [
        115, 254, 155, 212, 220, 142, 184, 10, 96, 166, 39, 107, 205, 233, 133, 186, 134, 94, 137,
        81, 196, 110, 150, 62, 1, 188, 184, 198, 20, 135, 24, 131,
    ];
    /// Devnet `agent-registry-8004`: `8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C`
    pub const PROGRAM_ID_DEVNET: [u8; 32] = [
        115, 254, 154, 49, 129, 129, 48, 89, 58, 8, 167, 194, 122, 8, 194, 220, 245, 213, 204, 195,
        104, 134, 39, 243, 10, 135, 13, 68, 20, 212, 2, 39,
    ];
    /// `sha256("account:AgentAccount")[..8]`
    pub const AGENT_ACCOUNT_DISCRIMINATOR: [u8; 8] = [241, 119, 69, 140, 233, 9, 112, 50];

    const OWNER: usize = 8 + 32 + 32;
    const ASSET: usize = OWNER + 32;
    const AGENT_WALLET_TAG: usize = ASSET + 32 + 1 + 1;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct AgentRef {
        pub owner: [u8; 32],
        pub asset: [u8; 32],
        pub agent_wallet: Option<[u8; 32]>,
    }

    impl AgentRef {
        /// True if `signer` may act for this agent: its verified operational wallet, or
        /// the owner when no operational wallet is set.
        pub fn is_controlled_by(&self, signer: &[u8; 32]) -> bool {
            match &self.agent_wallet {
                Some(w) => w == signer,
                None => &self.owner == signer,
            }
        }
    }

    pub fn parse_agent(owner_program: &[u8; 32], data: &[u8]) -> Option<AgentRef> {
        if owner_program != &PROGRAM_ID_MAINNET && owner_program != &PROGRAM_ID_DEVNET {
            return None;
        }
        if data.len() < AGENT_WALLET_TAG + 33 || data[0..8] != AGENT_ACCOUNT_DISCRIMINATOR {
            return None;
        }
        let mut owner = [0u8; 32];
        owner.copy_from_slice(&data[OWNER..OWNER + 32]);
        let mut asset = [0u8; 32];
        asset.copy_from_slice(&data[ASSET..ASSET + 32]);
        let agent_wallet = match data[AGENT_WALLET_TAG] {
            1 => {
                let mut w = [0u8; 32];
                w.copy_from_slice(&data[AGENT_WALLET_TAG + 1..AGENT_WALLET_TAG + 33]);
                Some(w)
            }
            _ => None,
        };
        Some(AgentRef {
            owner,
            asset,
            agent_wallet,
        })
    }
}

#[inline]
fn u16_at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}
#[inline]
fn u32_at(d: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
}
#[inline]
fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}
