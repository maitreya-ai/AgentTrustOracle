//! The Anchor program's own serialisation must match the interface crate and TS SDK.
use anchor_lang::{AccountSerialize, Discriminator, Space};
use serde_json::Value;
use trust_oracle::{instructions::verify_score_proof::compute_root, state::*};

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

fn num(v: &Value) -> u64 {
    match v {
        Value::Number(n) => n.as_u64().unwrap(),
        Value::String(s) => s.parse().unwrap(),
        _ => panic!("not a number"),
    }
}

#[test]
fn agent_score_size_and_discriminator_match_interface() {
    assert_eq!(AgentScore::SPACE, trust_oracle_interface::AGENT_SCORE_SIZE);
    assert_eq!(8 + AgentScore::INIT_SPACE, 128);
    assert_eq!(
        AgentScore::DISCRIMINATOR,
        trust_oracle_interface::AGENT_SCORE_DISCRIMINATOR
    );
    assert_eq!(
        trust_oracle::ID.to_bytes(),
        trust_oracle_interface::PROGRAM_ID
    );
    assert_eq!(trust_oracle::SCORE_SEED, trust_oracle_interface::SCORE_SEED);
    assert_eq!(trust_oracle::EPOCH_SEED, trust_oracle_interface::EPOCH_SEED);
    assert_eq!(
        trust_oracle::CONFIG_SEED,
        trust_oracle_interface::CONFIG_SEED
    );
}

#[test]
fn anchor_serialisation_matches_ts_fixture_bytes() {
    let f = fixture("agent-score.json");
    let x = &f["fields"];
    let agent: [u8; 32] = hex(f["agentHex"].as_str().unwrap()).try_into().unwrap();
    let account = AgentScore {
        version: num(&x["version"]) as u8,
        bump: num(&x["bump"]) as u8,
        registry: num(&x["registry"]) as u8,
        agent: agent.into(),
        score: num(&x["score"]) as u16,
        confidence: num(&x["confidence"]) as u16,
        flags: num(&x["flags"]) as u32,
        wash_ratio_bps: num(&x["washRatioBps"]) as u16,
        unique_payers: num(&x["uniquePayers"]) as u32,
        organic_volume: num(&x["organicVolume"]),
        raw_volume: num(&x["rawVolume"]),
        epoch: num(&x["epoch"]),
        updated_slot: num(&x["updatedSlot"]),
        updated_at: num(&x["updatedAt"]) as i64,
        prev_score: num(&x["prevScore"]) as u16,
        methodology_version: num(&x["methodologyVersion"]) as u16,
        reserved: [0; 27],
    };
    let mut bytes = Vec::new();
    account.try_serialize(&mut bytes).unwrap();
    assert_eq!(bytes, hex(f["hex"].as_str().unwrap()));
    assert_eq!(
        trust_oracle_interface::AgentScoreView::parse(&bytes).unwrap(),
        account.view()
    );
}

#[test]
fn instruction_and_account_discriminators_match_ts() {
    use trust_oracle::instruction as ix;
    let d = fixture("discriminators.json");
    let bytes =
        |v: &Value| -> Vec<u8> { v.as_array().unwrap().iter().map(|b| num(b) as u8).collect() };
    let i = &d["instructions"];
    assert_eq!(ix::Initialize::DISCRIMINATOR, bytes(&i["initialize"]));
    assert_eq!(ix::UpdateConfig::DISCRIMINATOR, bytes(&i["update_config"]));
    assert_eq!(ix::ProposeAdmin::DISCRIMINATOR, bytes(&i["propose_admin"]));
    assert_eq!(ix::AcceptAdmin::DISCRIMINATOR, bytes(&i["accept_admin"]));
    assert_eq!(ix::PublishEpoch::DISCRIMINATOR, bytes(&i["publish_epoch"]));
    assert_eq!(ix::UpsertScore::DISCRIMINATOR, bytes(&i["upsert_score"]));
    assert_eq!(ix::CloseScore::DISCRIMINATOR, bytes(&i["close_score"]));
    assert_eq!(ix::AssertTrust::DISCRIMINATOR, bytes(&i["assert_trust"]));
    assert_eq!(
        ix::VerifyScoreProof::DISCRIMINATOR,
        bytes(&i["verify_score_proof"])
    );
    let a = &d["accounts"];
    assert_eq!(OracleConfig::DISCRIMINATOR, bytes(&a["OracleConfig"]));
    assert_eq!(ScoreEpoch::DISCRIMINATOR, bytes(&a["ScoreEpoch"]));
    assert_eq!(AgentScore::DISCRIMINATOR, bytes(&a["AgentScore"]));
}

#[test]
fn onchain_merkle_verification_matches_ts_tree() {
    let f = fixture("merkle.json");
    let root: [u8; 32] = hex(f["root"].as_str().unwrap()).try_into().unwrap();
    for l in f["leaves"].as_array().unwrap() {
        let leaf = trust_oracle_interface::ScoreLeaf {
            agent: hex(l["agentHex"].as_str().unwrap()).try_into().unwrap(),
            registry: num(&l["registry"]) as u8,
            epoch: num(&l["epoch"]),
            score: num(&l["score"]) as u16,
            confidence: num(&l["confidence"]) as u16,
            flags: num(&l["flags"]) as u32,
            wash_ratio_bps: num(&l["washRatioBps"]) as u16,
            unique_payers: num(&l["uniquePayers"]) as u32,
            organic_volume: num(&l["organicVolume"]),
        };
        let proof: Vec<[u8; 32]> = l["proof"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| hex(p.as_str().unwrap()).try_into().unwrap())
            .collect();
        assert_eq!(compute_root(&leaf, &proof), root);
    }
}
