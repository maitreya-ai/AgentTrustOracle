# Project overview

**Agent Trust Oracle scores Solana agents by the money they actually earn from real counterparties, strips out wash trading and self-dealing, and publishes the result onchain so any program can decide which agents to trust.**

---

## The problem

Agent payments on Solana are growing fast. The headline numbers mostly measure noise.

- Analysts who filtered x402 activity for self-transfers and circular flows found adjusted volume to be a small fraction of the raw figures. A Visa–Artemis analysis put adjusted x402 volume at roughly **$19M** against raw counts implying hundreds of millions. Artemis's own wash filter gave about **$1.6M** for a 30-day window. ([Startup Fortune](https://startupfortune.com/ai-agents-have-moved-over-200-million-payments-on-x402-but-half-may-be-fake/), [Artemis](https://x.com/artemis/status/2031768320081277029))
- On Solana DEXs, Bitquery traced large shares of volume to a handful of wallets using round-trip and funding-pattern heuristics. ([Bitquery](https://bitquery.io/blog/solana-volume-numbers-are-a-lie))

For anyone who has to decide whether to **trust an agent**, raw volume is not just useless but misleading. That includes a lending protocol, a marketplace, a facilitator, or another agent choosing whom to pay. Inflating it costs a few dollars in fees.

The identity layer now exists. The [Solana Agent Registry](https://solana.com/agent-registry) (ERC-8004 compatible) gives agents verifiable identities, and its own list of intended uses includes **DeFi protocols open only to agents with verified reputation scores** and **auditing networks where validators stake to verify agent behaviour**. What's missing is a reputation signal that can't be bought.

## Why now

- **Settlement rails are live.** Solana Foundation [Payment Channels](https://github.com/solana-foundation/payment-channels) (`CHNLxYv…`) went live on mainnet in September 2026. They back x402 `upto` and MPP `session`, alongside x402 `exact` through a dozen-plus facilitators. Agent payments now leave a clean, parseable onchain trail.
- **Identity is standardised.** 8004 (QuantuLabs, mainnet `8oo4dC4J…`) and SATI (Cascade) give each agent a stable id plus linked wallets. The oracle builds on them and adds no identity system of its own.
- **Existing reputation is feedback-based.** ATOM (the 8004 reputation engine) and SATI aggregate _ratings_ that clients submit. Those are useful, but ratings are cheap talk. Nothing yet scores the economic ground truth.

## What we're building

| Surface                                     | For                         | What it does                                                                                                                               |
| ------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Onchain scores** (`trust-oracle` program) | Protocols                   | Per-agent `AgentScore` accounts readable with zero CPI, plus an epoch Merkle root covering every scored agent                              |
| **`trust-oracle-interface`** crate          | Program developers          | `no_std`, zero-dependency reader: `load_checked` + `TrustPolicy::STANDARD.check(..)` in two lines. Works from Anchor, Pinocchio and native |
| **Score API** (x402)                        | Agents and apps             | Free tiers/proofs, $0.001 scores, $0.01 forensic reports, paid per request in USDC                                                         |
| **Ecosystem stats**                         | Foundation, analysts, press | The "honest" number: raw vs organic agent-payment volume, by rail                                                                          |
| **`@ato/sdk`**                              | TS developers               | Read accounts, check policies, verify proofs, pay for API calls                                                                            |

## Who uses it

1. **DeFi protocols.** Undercollateralised credit for agents, agents-only pools, rate tiers. Gate on `score ≥ 650 ∧ confidence ≥ 60% ∧ no SELF_DEALING|CIRCULAR_FLOW ∧ age ≤ 2 days`.
2. **Facilitators and payment operators.** Risk-score merchants and payers, and spot wash-trading merchants before they distort public stats.
3. **Agent marketplaces and registries.** Rank listings by earned trust. Show badges on 8004 Scan / SATI dashboards.
4. **Agents themselves.** Decide whether to pay, extend credit to, or subcontract another agent: one paid API call, or one account read.
5. **Ecosystem observers.** Cite organic volume instead of raw volume.

## How it's different

|                    | Feedback reputation (ATOM, SATI) | Analytics dashboards | **Agent Trust Oracle**                                         |
| ------------------ | -------------------------------- | -------------------- | -------------------------------------------------------------- |
| Signal             | Client-submitted ratings         | Onchain flows        | Onchain flows                                                  |
| Sybil resistance   | HLL unique clients, sybil tax    | Heuristic filters    | Entity clustering + cycle cancellation + TrustRank credibility |
| Composable onchain | Yes                              | No                   | **Yes, zero-CPI read**                                         |
| Verifiable         | Hash-chained feedback            | No                   | **Merkle root + methodology and inputs hashes**                |
| Griefing-resistant | Partially                        | n/a                  | **Unsolicited inflow can't lower a score (tested)**            |

These are complementary. A mature trust stack combines _what clients say_ (feedback) with _what money did_ (this oracle). The roadmap includes writing oracle attestations back into the 8004 Reputation Registry.

## Design principles

- **Money is the signal; credibility weights it.** See [methodology.md](methodology.md).
- **Penalties require participation.** Only an agent's own flows can penalise it.
- **Reproducible by anyone.** Deterministic pipeline, committed methodology and inputs hashes.
- **Composable by default.** Fixed 128-byte layout, zero-CPI reads, guard instruction, Merkle proofs.
- **No new identity silo.** Read existing registries behind a pluggable `IdentityProvider`, so the oracle can also serve as the trust layer for a host agent network.

## Business model

- **Free:** onchain scores (a public good, and the composability flywheel), badges, proofs, ecosystem stats.
- **Paid per query via x402:** fresh full scores, wallet resolution, forensic reports, batch queries. The API's own revenue settles as x402 payments, so the oracle is itself a scored agent.
- **Later:** webhooks/alerts on score changes, private scoring for facilitators, SLA'd feeds.

There's a deliberate tension here. Onchain scores are free to read, so the API sells _detail, freshness, explanations and coverage_ (every payee, not only materialised agents), not the number itself.

## Cold start

Agent registry volume is still small. Coverage doesn't wait for it:

1. **Score every x402 payee wallet from day one** (`registry = wallet`). Raw x402 traffic already exists, and those wallets are committed in the epoch root.
2. **Lead with the free ecosystem stat.** A credible "organic vs raw" number is useful immediately and earns distribution.
3. **Distribution partners:** facilitators (PayAI supported the 8004 mainnet deploy), 8004 Scan / SATI dashboards, x402 explorers.
4. **Registry agents inherit history:** when an agent registers and links a wallet, its payment history is already indexed.

## Risks

| Risk                                           | Mitigation                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Cold start: little registered-agent volume     | Wallet-level coverage; free ecosystem stats                                                                                             |
| Gaming the published formula                   | Defences rest on costs (age, real counterparties), not secrecy; versioned methodology; threat model in [methodology.md](methodology.md) |
| Centralised publisher                          | Detectable via commitments now; staked multi-publisher attestation and disputes later                                                   |
| Data scale (millions of facilitator txs)       | gRPC for live data; Substreams / archival RPC for history                                                                               |
| Registry layout drift                          | Decoders pinned to source, discriminator-checked, failures counted                                                                      |
| False positives on legitimate reciprocal trade | Only _intense_ cycles penalise; incidental loops are merely excluded                                                                    |

## MVP plan (4–6 weeks)

Status reflects this repository.

- [x] Indexer over x402 `exact` and payment-channel settlements (classifiers, RPC poll, LaserStream stream, backfill, cursors)
- [x] Wash detection: circular flows (cycle cancellation) and wallet clusters funded from the same source (funding resolution + entity resolution)
- [x] Scoring engine with TrustRank credibility, flags and Merkle commitments, with scenario tests
- [x] Score API that charges per query through x402
- [x] Anchor program storing scores onchain, plus `assert_trust` and `verify_score_proof`
- [x] Zero-dependency interface crate and example integrator program
- [x] Cross-language parity fixtures (Rust ⇄ TS)
- [ ] Install the Solana toolchain, `anchor build`, run LiteSVM lifecycle tests
- [ ] Devnet deploy + initialize; run the indexer against devnet facilitator traffic
- [ ] Mainnet read-only indexing (facilitators + channels) and a first public ecosystem stat
- [ ] Calibrate the methodology on real data; publish v1 epochs
- [ ] Mainnet program deploy behind a Squads multisig

## Roadmap after the MVP

- **Trust-minimised publishing.** Multiple staked publishers attest to the same root, with an optimistic dispute window where anyone can challenge with a recomputation. This matches the registry's "validators stake to verify agent behaviour" use case. Later, a zk proof of `runEpoch` (SP1 / RISC Zero) over committed inputs.
- **Write-back to the 8004 Reputation Registry** as a reputable auditor client, so scores show up wherever 8004 reputation is read.
- **SATI `IdentityProvider`**, agent-card wallet discovery (`agent_uri` → declared payment addresses), and a provider for host agent networks.
- **MCP server** (`@x402/mcp`) so LLM agents can call `get_trust_score` as a paid tool.
- **Payer-side reputation:** agents that reliably pay their bills, for credit use cases.
- **Funding-time correlation** (many wallets withdrawn from one CEX in one burst) and transfer-hook-aware Token-2022 handling.
- **Substreams backfill** using the existing x402 Substreams module.

## Open questions

- **Host-network integration.** The pitch mentioned serving as a specific agent network's trust layer. Its identity system can plug in as an `IdentityProvider`; it needs a spec or link to integrate.
- **Pricing.** $0.001 / $0.01 / $0.02 are placeholders to validate with facilitators and integrators.

## Sources

- Solana Agent Registry: https://solana.com/agent-registry · QuantuLabs 8004-solana: https://github.com/QuantuLabs/8004-solana · ATOM: https://github.com/QuantuLabs/8004-atom
- SATI: https://github.com/cascade-protocol/sati · sRFC draft: https://github.com/solana-foundation/SRFCs/discussions/7
- Payment Channels: https://github.com/solana-foundation/payment-channels · announcement: https://solana.com/news/payment-channels-1-million-payments-per-second
- x402 exact-SVM spec: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md · x402 v2 spec: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
- x402 on Solana detection (Substreams): https://github.com/PaulieB14/x402-solana-pulse
- MPP on Solana: https://solana.com/docs/payments/agentic-payments/mpp
- Wash-trading analyses: [Startup Fortune](https://startupfortune.com/ai-agents-have-moved-over-200-million-payments-on-x402-but-half-may-be-fake/) · [Artemis](https://x.com/artemis/status/2031768320081277029) · [Bitquery](https://bitquery.io/blog/solana-volume-numbers-are-a-lie)
- PageRank monotonicity: Avrachenkov & Litvak, "The effect of new links on Google PageRank" (2006)
