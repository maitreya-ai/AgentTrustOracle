//! End-to-end program tests on LiteSVM. They need the SBF binary:
//!
//!     anchor build && cargo test -p program-tests
//!
//! Without `target/deploy/trust_oracle.so` every test prints a skip notice and passes, so
//! `cargo test --workspace` still works on machines without the Solana toolchain.
use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    trust_oracle::{
        accounts as accts, error::OracleError, instruction as ixs,
        instructions::verify_score_proof::compute_root, state::*, CONFIG_SEED, EPOCH_SEED,
        SCORE_SEED,
    },
};

fn program_bytes() -> Option<Vec<u8>> {
    std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/trust_oracle.so"
    ))
    .ok()
}

/// Skips when the binary is missing, unless `REQUIRE_SBF` is set (CI), where it fails loudly.
macro_rules! require_program {
    () => {
        match program_bytes() {
            Some(b) => b,
            None if std::env::var_os("REQUIRE_SBF").is_some() => {
                panic!("REQUIRE_SBF is set but target/deploy/trust_oracle.so is missing")
            }
            None => {
                eprintln!("skipping: target/deploy/trust_oracle.so not found (run `anchor build`)");
                return;
            }
        }
    };
}

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    publisher: Keypair,
}

fn pid() -> Pubkey {
    trust_oracle::id()
}
fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &pid()).0
}
fn epoch_pda(epoch: u64) -> Pubkey {
    Pubkey::find_program_address(&[EPOCH_SEED, &epoch.to_le_bytes()], &pid()).0
}
fn score_pda(agent: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SCORE_SEED, agent.as_ref()], &pid()).0
}

fn setup(bytes: &[u8]) -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program(pid(), bytes).unwrap();
    let admin = Keypair::new();
    let publisher = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&publisher.pubkey(), 10_000_000_000).unwrap();

    // LiteSVM deploys with no upgrade authority. Patch the ProgramData header
    // (bincode: tag u32 | slot u64 | Option<Pubkey>) so `admin` is the authority and
    // `initialize`'s upgrade-authority gate is exercised for real.
    let program_data =
        Pubkey::find_program_address(&[pid().as_ref()], &bpf_loader_upgradeable::ID).0;
    let mut account = svm.get_account(&program_data).expect("program data");
    account.data[12] = 1;
    account.data[13..45].copy_from_slice(admin.pubkey().as_ref());
    svm.set_account(program_data, account).unwrap();

    Env {
        svm,
        admin,
        publisher,
    }
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair) -> Result<(), String> {
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    let res = svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e.err));
    svm.expire_blockhash();
    res
}

fn expect_err(res: Result<(), String>, err: OracleError) {
    let code = u32::from(err);
    let msg = res.expect_err("expected failure");
    assert!(
        msg.contains(&format!("Custom({code})")),
        "expected {code}, got {msg}"
    );
}

fn initialize(env: &mut Env) {
    let program_data =
        Pubkey::find_program_address(&[pid().as_ref()], &bpf_loader_upgradeable::ID).0;
    let ix = Instruction::new_with_bytes(
        pid(),
        &ixs::Initialize {
            args: InitializeArgs {
                publisher: env.publisher.pubkey(),
                methodology_version: 1,
            },
        }
        .data(),
        accts::Initialize {
            admin: env.admin.pubkey(),
            config: config_pda(),
            program: pid(),
            program_data,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let admin = env.admin.insecure_clone();
    send(&mut env.svm, ix, &admin).expect("initialize");
}

fn publish_epoch_ix(publisher: &Pubkey, epoch: u64, root: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(
        pid(),
        &ixs::PublishEpoch {
            args: PublishEpochArgs {
                epoch,
                merkle_root: root,
                methodology_hash: [1; 32],
                inputs_hash: [2; 32],
                window_start: 0,
                window_end: 1,
                agent_count: 2,
                methodology_version: 1,
            },
        }
        .data(),
        accts::PublishEpoch {
            publisher: *publisher,
            config: config_pda(),
            epoch: epoch_pda(epoch),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn upsert_ix(publisher: &Pubkey, latest_epoch: u64, args: UpsertScoreArgs) -> Instruction {
    Instruction::new_with_bytes(
        pid(),
        &ixs::UpsertScore { args }.data(),
        accts::UpsertScore {
            publisher: *publisher,
            config: config_pda(),
            epoch: epoch_pda(latest_epoch),
            agent_score: score_pda(&args.agent),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn assert_ix(agent: &Pubkey, policy: TrustPolicyArgs) -> Instruction {
    Instruction::new_with_bytes(
        pid(),
        &ixs::AssertTrust { policy }.data(),
        accts::AssertTrust {
            agent_score: score_pda(agent),
        }
        .to_account_metas(None),
    )
}

fn score_args(agent: Pubkey, score: u16) -> UpsertScoreArgs {
    UpsertScoreArgs {
        agent,
        registry: 0,
        score,
        confidence: 9_000,
        flags: 0,
        wash_ratio_bps: 10,
        unique_payers: 42,
        organic_volume: 1_000_000,
        raw_volume: 1_100_000,
    }
}

fn read_score(svm: &LiteSVM, agent: &Pubkey) -> AgentScore {
    let account = svm.get_account(&score_pda(agent)).expect("score account");
    AgentScore::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn publish_upsert_and_gate() {
    let bytes = require_program!();
    let mut env = setup(&bytes);
    initialize(&mut env);
    let publisher = env.publisher.insecure_clone();
    let agent = Pubkey::new_unique();

    send(
        &mut env.svm,
        publish_epoch_ix(&publisher.pubkey(), 1, [7; 32]),
        &publisher,
    )
    .unwrap();
    send(
        &mut env.svm,
        upsert_ix(&publisher.pubkey(), 1, score_args(agent, 720)),
        &publisher,
    )
    .unwrap();

    let s = read_score(&env.svm, &agent);
    assert_eq!((s.score, s.epoch, s.prev_score, s.version), (720, 1, 0, 1));
    // The account is readable by the zero-dependency interface crate.
    let raw = env.svm.get_account(&score_pda(&agent)).unwrap();
    let view =
        trust_oracle_interface::load_checked(&raw.owner.to_bytes(), &raw.data, &agent.to_bytes())
            .unwrap();
    assert_eq!(view.score, 720);

    let ok = TrustPolicyArgs {
        min_score: 700,
        min_confidence: 5_000,
        max_age_slots: 0,
        forbidden_flags: 0,
    };
    send(&mut env.svm, assert_ix(&agent, ok), &publisher).unwrap();
    let too_strict = TrustPolicyArgs {
        min_score: 800,
        ..ok
    };
    expect_err(
        send(&mut env.svm, assert_ix(&agent, too_strict), &publisher),
        OracleError::ScoreTooLow,
    );

    // Next epoch: prev_score carries forward.
    send(
        &mut env.svm,
        publish_epoch_ix(&publisher.pubkey(), 2, [8; 32]),
        &publisher,
    )
    .unwrap();
    send(
        &mut env.svm,
        upsert_ix(&publisher.pubkey(), 2, score_args(agent, 810)),
        &publisher,
    )
    .unwrap();
    let s = read_score(&env.svm, &agent);
    assert_eq!((s.score, s.prev_score, s.epoch), (810, 720, 2));
}

#[test]
fn rejects_unauthorized_and_malformed_writes() {
    let bytes = require_program!();
    let mut env = setup(&bytes);
    initialize(&mut env);
    let publisher = env.publisher.insecure_clone();
    let intruder = Keypair::new();
    env.svm.airdrop(&intruder.pubkey(), 1_000_000_000).unwrap();

    expect_err(
        send(
            &mut env.svm,
            publish_epoch_ix(&intruder.pubkey(), 1, [0; 32]),
            &intruder,
        ),
        OracleError::Unauthorized,
    );
    expect_err(
        send(
            &mut env.svm,
            publish_epoch_ix(&publisher.pubkey(), 2, [0; 32]),
            &publisher,
        ),
        OracleError::EpochOutOfOrder,
    );
    send(
        &mut env.svm,
        publish_epoch_ix(&publisher.pubkey(), 1, [0; 32]),
        &publisher,
    )
    .unwrap();
    expect_err(
        send(
            &mut env.svm,
            upsert_ix(
                &publisher.pubkey(),
                1,
                score_args(Pubkey::new_unique(), 1_001),
            ),
            &publisher,
        ),
        OracleError::InvalidScore,
    );
}

#[test]
fn pause_blocks_publishing() {
    let bytes = require_program!();
    let mut env = setup(&bytes);
    initialize(&mut env);
    let admin = env.admin.insecure_clone();
    let publisher = env.publisher.insecure_clone();
    let pause = Instruction::new_with_bytes(
        pid(),
        &ixs::UpdateConfig {
            args: UpdateConfigArgs {
                paused: Some(true),
                ..Default::default()
            },
        }
        .data(),
        accts::UpdateConfig {
            admin: admin.pubkey(),
            config: config_pda(),
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, pause, &admin).unwrap();
    expect_err(
        send(
            &mut env.svm,
            publish_epoch_ix(&publisher.pubkey(), 1, [0; 32]),
            &publisher,
        ),
        OracleError::Paused,
    );
}

#[test]
fn merkle_proof_verifies_agents_without_accounts() {
    let bytes = require_program!();
    let mut env = setup(&bytes);
    initialize(&mut env);
    let publisher = env.publisher.insecure_clone();

    let leaf = |agent: Pubkey, score: u16| ScoreLeafArgs {
        agent,
        registry: 0,
        epoch: 1,
        score,
        confidence: 8_000,
        flags: 0,
        wash_ratio_bps: 0,
        unique_payers: 9,
        organic_volume: 5_000_000,
    };
    let (a, b) = (
        leaf(Pubkey::new_unique(), 640),
        leaf(Pubkey::new_unique(), 910),
    );
    let hash_b = compute_root(&b.into(), &[]);
    let root = compute_root(&a.into(), &[hash_b]);
    send(
        &mut env.svm,
        publish_epoch_ix(&publisher.pubkey(), 1, root),
        &publisher,
    )
    .unwrap();

    let verify = |l: ScoreLeafArgs, proof: Vec<[u8; 32]>| {
        Instruction::new_with_bytes(
            pid(),
            &ixs::VerifyScoreProof { leaf: l, proof }.data(),
            accts::VerifyScoreProof {
                epoch: epoch_pda(1),
            }
            .to_account_metas(None),
        )
    };
    send(&mut env.svm, verify(a, vec![hash_b]), &publisher).unwrap();
    let forged = ScoreLeafArgs { score: 999, ..a };
    expect_err(
        send(&mut env.svm, verify(forged, vec![hash_b]), &publisher),
        OracleError::InvalidProof,
    );
}
