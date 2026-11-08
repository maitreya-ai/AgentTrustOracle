//! Cross-language parity: these fixtures are written by `bun run fixtures` from the
//! TypeScript SDK/core. If any assertion here fails, the onchain layout and the TS clients
//! disagree.
use serde_json::Value;
use sha2::{Digest, Sha256};
use trust_oracle_interface::*;

fn fixture(name: &str) -> Value {
    let path = format!("{}/../../fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("run `bun run fixtures`")).unwrap()
}

fn hex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn arr32(v: &[u8]) -> [u8; 32] {
    v.try_into().unwrap()
}

fn num(v: &Value) -> u64 {
    match v {
        Value::Number(n) => n.as_u64().unwrap(),
        Value::String(s) => s.parse().unwrap(),
        _ => panic!("not a number: {v}"),
    }
}

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

#[test]
fn agent_score_layout_matches_ts_encoder() {
    let f = fixture("agent-score.json");
    let bytes = hex(f["hex"].as_str().unwrap());
    assert_eq!(bytes.len(), AGENT_SCORE_SIZE);
    let v = AgentScoreView::parse(&bytes).unwrap();
    let x = &f["fields"];
    assert_eq!(v.version as u64, num(&x["version"]));
    assert_eq!(v.bump as u64, num(&x["bump"]));
    assert_eq!(v.registry as u64, num(&x["registry"]));
    assert_eq!(v.agent.to_vec(), hex(f["agentHex"].as_str().unwrap()));
    assert_eq!(v.score as u64, num(&x["score"]));
    assert_eq!(v.confidence as u64, num(&x["confidence"]));
    assert_eq!(v.flags as u64, num(&x["flags"]));
    assert_eq!(v.wash_ratio_bps as u64, num(&x["washRatioBps"]));
    assert_eq!(v.unique_payers as u64, num(&x["uniquePayers"]));
    assert_eq!(v.organic_volume, num(&x["organicVolume"]));
    assert_eq!(v.raw_volume, num(&x["rawVolume"]));
    assert_eq!(v.epoch, num(&x["epoch"]));
    assert_eq!(v.updated_slot, num(&x["updatedSlot"]));
    assert_eq!(v.updated_at as u64, num(&x["updatedAt"]));
    assert_eq!(v.prev_score as u64, num(&x["prevScore"]));
    assert_eq!(v.methodology_version as u64, num(&x["methodologyVersion"]));
}

#[test]
fn load_checked_rejects_foreign_or_mismatched_accounts() {
    let f = fixture("agent-score.json");
    let bytes = hex(f["hex"].as_str().unwrap());
    let agent = arr32(&hex(f["agentHex"].as_str().unwrap()));
    assert!(load_checked(&PROGRAM_ID, &bytes, &agent).is_ok());
    assert_eq!(
        load_checked(&[9u8; 32], &bytes, &agent),
        Err(ParseError::WrongOwner)
    );
    assert_eq!(
        load_checked(&PROGRAM_ID, &bytes, &[1u8; 32]),
        Err(ParseError::AgentMismatch)
    );
    let mut bad = bytes.clone();
    bad[0] ^= 0xff;
    assert_eq!(
        load_checked(&PROGRAM_ID, &bad, &agent),
        Err(ParseError::WrongDiscriminator)
    );
    assert_eq!(
        load_checked(&PROGRAM_ID, &bytes[..100], &agent),
        Err(ParseError::WrongSize)
    );
}

#[test]
fn merkle_encoding_and_proofs_match_ts() {
    let f = fixture("merkle.json");
    let root = arr32(&hex(f["root"].as_str().unwrap()));
    for l in f["leaves"].as_array().unwrap() {
        let leaf = ScoreLeaf {
            agent: arr32(&hex(l["agentHex"].as_str().unwrap())),
            registry: num(&l["registry"]) as u8,
            epoch: num(&l["epoch"]),
            score: num(&l["score"]) as u16,
            confidence: num(&l["confidence"]) as u16,
            flags: num(&l["flags"]) as u32,
            wash_ratio_bps: num(&l["washRatioBps"]) as u16,
            unique_payers: num(&l["uniquePayers"]) as u32,
            organic_volume: num(&l["organicVolume"]),
        };
        let encoded = encode_leaf(&leaf);
        assert_eq!(encoded.to_vec(), hex(l["encoded"].as_str().unwrap()));
        let leaf_hash = sha(&encoded);
        assert_eq!(leaf_hash.to_vec(), hex(l["hash"].as_str().unwrap()));
        let proof: Vec<[u8; 32]> = l["proof"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| arr32(&hex(p.as_str().unwrap())))
            .collect();
        assert_eq!(merkle_root_from_proof(leaf_hash, &proof, sha), root);

        let mut forged = leaf;
        forged.score = forged.score.wrapping_add(1);
        assert_ne!(
            merkle_root_from_proof(sha(&encode_leaf(&forged)), &proof, sha),
            root
        );
    }
}

#[test]
fn policy_decisions_match_ts() {
    let cases = fixture("policy-cases.json");
    for c in cases.as_array().unwrap() {
        let p = &c["policy"];
        let policy = TrustPolicy {
            min_score: num(&p["minScore"]) as u16,
            min_confidence: num(&p["minConfidence"]) as u16,
            max_age_slots: num(&p["maxAgeSlots"]),
            forbidden_flags: num(&p["forbiddenFlags"]) as u32,
        };
        let view = AgentScoreView {
            version: 1,
            bump: 255,
            registry: 0,
            agent: [0; 32],
            score: num(&c["score"]) as u16,
            confidence: num(&c["confidence"]) as u16,
            flags: num(&c["flags"]) as u32,
            wash_ratio_bps: 0,
            unique_payers: 0,
            organic_volume: 0,
            raw_volume: 0,
            epoch: 1,
            updated_slot: num(&c["updatedSlot"]),
            updated_at: 0,
            prev_score: 0,
            methodology_version: 1,
        };
        let got = match policy.check(&view, num(&c["currentSlot"])) {
            Ok(()) => Value::Null,
            Err(v) => Value::String(format!("{v:?}")),
        };
        assert_eq!(got, c["expected"], "case {c}");
    }
}

#[test]
fn presets_reject_penalising_flags() {
    let mut v =
        AgentScoreView::parse(&hex(fixture("agent-score.json")["hex"].as_str().unwrap())).unwrap();
    v.flags = flags::CIRCULAR_FLOW;
    assert_eq!(
        TrustPolicy::STANDARD.check(&v, v.updated_slot),
        Err(PolicyViolation::ForbiddenFlags)
    );
}

#[test]
fn erc8004_agent_ref_parses_wallet_and_owner() {
    let mut data = vec![0u8; 8 + 32 * 4 + 2 + 33];
    data[..8].copy_from_slice(&erc8004::AGENT_ACCOUNT_DISCRIMINATOR);
    data[72..104].copy_from_slice(&[7u8; 32]); // owner
    data[104..136].copy_from_slice(&[8u8; 32]); // asset
    data[138] = 1;
    data[139..171].copy_from_slice(&[9u8; 32]); // agent_wallet
    let a = erc8004::parse_agent(&erc8004::PROGRAM_ID_MAINNET, &data).unwrap();
    assert_eq!(a.owner, [7u8; 32]);
    assert_eq!(a.asset, [8u8; 32]);
    assert!(a.is_controlled_by(&[9u8; 32]));
    assert!(
        !a.is_controlled_by(&[7u8; 32]),
        "owner cannot act when an operational wallet is set"
    );
    assert!(erc8004::parse_agent(&[0u8; 32], &data).is_none());
}
