# Scoring methodology (v1)

This is the specification of `runEpoch` in `packages/core`. Every number below lives in `METHODOLOGY_V1` (`packages/core/src/methodology.ts`), and the SHA-256 of that object is committed onchain with each epoch. If a value here disagrees with the code, the code and the committed hash are authoritative.

## Principles

1. **Money is the signal.** Ratings are cheap to fake. Paying a third party is not. Scores are built only from settled stablecoin payments.
2. **Count net demand, not volume.** Value that goes around a loop proves nothing, so circulation is removed before anything is credited.
3. **Weigh payers by credibility.** A dollar from an aged wallet that pays many unrelated services counts. A dollar from a fresh single-purpose wallet barely does.
4. **Penalties require participation.** Only flows an agent took part in (self-dealing, tight cycles) can penalise it. A payment an agent did not reciprocate can never lower its score. This is tested.
5. **Reproducible.** The same inputs and methodology always produce the same root.

## Inputs

For an epoch with `asOf` timestamp `T`:

- **Payments** with `T − 30d < blockTime ≤ T`, `usdMicros ≥ 1`, and payer ≠ payee.
- **Wallet links** (indexer evidence) plus derived links. Each registry agent's wallets link to its owner. Owner→creator and owner→parent-agent links are added, and so are wallet→first-funder links.
- **Wallet profiles**: first-seen time and first funder.
- **Agents**: registry identities. If `scoreUnregisteredPayees` is set, any payee wallet with ≥ $1 raw inflow that no agent claims also becomes a `wallet` pseudo-agent. This is what gives the oracle cold-start coverage.
- **Infrastructure**: facilitators and the payment-channels program. These are never clustered and never scored.

Each wallet is attributed to exactly one agent: the earliest position in an agent's wallet list wins, then the smallest agent id. This stops inflow being double counted.

## Step 1: Entity resolution

Wallets are clustered with union-find over link evidence.

| Link                                                  | Strength | Hub cap |
| ----------------------------------------------------- | -------- | ------- |
| `registry_owner`, `registry_agent_wallet`             | hard     | 10,000  |
| `registry_parent`                                     | hard     | 100     |
| `fee_payer`, `close_destination`                      | hard     | 25      |
| `registry_creator`, `funded_by`, `channel_rent_payer` | soft     | 25–50   |

An address linked to more distinct counterparts than its kind's **hub cap** is treated as shared infrastructure (an exchange hot wallet, launchpad or relayer) and its links of that kind are dropped. Soft links additionally require both ends to be under `softFanoutCap = 50`. The entity id is the smallest member address.

## Step 2: Self-dealing

A payment whose payer and payee resolve to the same entity is **self-dealing**. It counts toward raw volume and toward the penalised share, and never toward organic volume.

## Step 3: Circulation removal

Cross-entity payments are aggregated into a directed graph. Within each strongly connected component, cycles of length 2…5 are found (shortest first, from each cycle's minimum node) and their bottleneck is subtracted. That leaves the **residual**, the net and acyclic part of the economy.

Each cancelled cycle gets an **intensity**:

```
intensity = bottleneck / min over participants of max(inflow, outflow)
```

- `intensity ≥ 0.25` → **wash ring**: penalised.
- below 0.25 → **incidental** circulation (real economies have loops): excluded from organic volume, not penalised.

The search has a step budget (5M). If it runs out, the epoch is marked `cyclesTruncated`.

Each payment's organic share is proportional: `organic = amount × residual(edge) / total(edge)`.

## Step 4: TrustRank

Personalised PageRank (damping 0.85) runs on the residual entity graph. Edge weights are `sqrt(organic USD)`, and each payer splits its trust across payees in proportion to spend.

**Seeds** (the teleport vector) are payers that are costly to fake:

```
seed(e) = min(1, ageDays / 30) × min(1, distinctPayees / 3)
```

`PR_ref` is the median PageRank of seeded entities. From it:

- `credibility(e) = min(1, PR(e) / PR_ref)`
- `trustLift(e) = PR(e) / PR_ref`

A sybil cluster that only pays itself receives almost no rank from the honest region, however much money it moves. Adding an inbound edge never lowers a node's PageRank (Avrachenkov & Litvak, 2006).

## Step 5: Per-agent score

For each agent, inflow to its wallets from other entities is credited as `organic × credibility(payer)`.

| Feature          | Definition                                            |
| ---------------- | ----------------------------------------------------- |
| credited USD     | Σ credited inflow                                     |
| effective payers | Σ over payer entities of `min(1, credited / $0.10)`   |
| repeat payers    | the same sum, restricted to payers active on ≥ 2 days |
| active days      | distinct UTC days with credited inflow                |
| trust lift       | `PR(entity) / PR_ref`                                 |

| Component | Formula                                           | Weight |
| --------- | ------------------------------------------------- | -----: |
| trust     | `1 − e^(−lift/2)`                                 |   0.30 |
| payers    | `1 − e^(−effectivePayers/10)`                     |   0.25 |
| volume    | `log10(1 + usd) / log10(1 + 10,000)`, capped at 1 |   0.20 |
| longevity | `activeDays / 15`, capped at 1                    |   0.15 |
| repeat    | `1 − e^(−repeatPayers/5)`                         |   0.10 |

The final score and confidence are:

```
penalisedRatio = (selfDealing + washRing) / (rawIn + rawOut)
score          = round(1000 × Σ wᵢcᵢ × (1 − penalisedRatio)²)
                 capped at 200 if penalisedRatio > 0.5
confidence     = 10,000 × (1 − e^(−effectivePayers/3)) × (1 − e^(−activeDays/3))   [bps]
```

Score and confidence are deliberately separate, with no shrinkage. A new agent scores low with low confidence, and consumers set both thresholds.

Every feature except the informational flags is a saturating sum over payers or days, so it is monotone in credited inflow.

## Flags

| Bit | Flag                  | Set when                                                                      | Effect        |
| --: | --------------------- | ----------------------------------------------------------------------------- | ------------- |
|   0 | `SELF_DEALING`        | self-dealing ≥ 5% of total flow                                               | penalising    |
|   1 | `CIRCULAR_FLOW`       | wash-ring flow ≥ 5% of total flow                                             | penalising    |
|   2 | `FUNDING_CLUSTER`     | ≥ 5 payer wallets collapse into ≤ 30% as many entities                        | informational |
|   3 | `CONCENTRATED_PAYERS` | top payer ≥ 80% of credited inflow                                            | informational |
|   4 | `FRESH_PAYERS`        | ≥ 50% of inflow from payers < 7 days old at first payment who pay nobody else | informational |
|   5 | `BURST`               | last-24h credited ≥ 5× the trailing daily average and ≥ $50                   | informational |
|   6 | `INSUFFICIENT_DATA`   | effective payers < 3 or active days < 3                                       | informational |
|   7 | `UNREGISTERED`        | raw-wallet pseudo-agent                                                       | informational |
|   8 | `MANUAL_REVIEW`       | set by governance                                                             | informational |

"Informational" means a flag never changes the score. Consumers decide which flags to forbid (`TrustPolicy.forbidden_flags`).

## Commitments

The commitment for each agent is a 64-byte leaf hashed with SHA-256:

```
leaf = sha256(0x00 ‖ agent[32] ‖ registry u8 ‖ epoch u64 ‖ score u16 ‖ confidence u16 ‖
              flags u32 ‖ wash_ratio_bps u16 ‖ unique_payers u32 ‖ organic_volume u64)
node = sha256(0x01 ‖ min(a,b) ‖ max(a,b))
```

Leaves are sorted by agent id, and an odd node is promoted unchanged.

## Calibration check

`bun run simulate` scores a synthetic economy:

| Agent  | Pattern                       |   Score | Notes                                            |
| ------ | ----------------------------- | ------: | ------------------------------------------------ |
| honest | 20 aged consumers, repeat use | **749** | 96% confidence, no flags                         |
| wash   | W → R1 → R2 → W, $1k/lap      |   **0** | `CIRCULAR_FLOW`, 100% wash                       |
| dealer | 5 self-funded sock wallets    |   **0** | `SELF_DEALING`                                   |
| farm   | 30 fresh wallets, one funder  |  **68** | 30 wallets → 1 entity, $150 raw → $3.33 credited |

Ecosystem: $30,680 raw → $180 organic (0.6%).

---

# Threat model

| #   | Attack                                | Mechanism                                | Defence                                                                                                                                  | Residual risk                                                                                                                                        |
| --- | ------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Self-payment through sock wallets** | Agent funds N wallets that pay it        | `funded_by` links merge the socks with the agent, so the flow is self-dealing                                                            | Socks funded through a CEX hub break the funding link. They still lack credibility (steps 4–5)                                                       |
| 2   | **Wash ring**                         | A→B→C→A repeatedly                       | Cycle cancellation removes all of it; high intensity makes it penalising                                                                 | Rings longer than 5 hops: raise `maxCycleLength` if seen                                                                                             |
| 3   | **Sybil payer farm**                  | Many fresh wallets pay the agent one way | Fresh wallets carry ~0 seed weight, so ~0 credibility. Shared funders collapse them into one entity                                      | A farm of _aged_ wallets that each pay several unrelated real services costs time and money; credibility is bounded by the farm's share of seed mass |
| 4   | **Collusion between real agents**     | Two operators trade back and forth       | Reciprocal flow cancels; at high intensity it is penalised                                                                               | Loose, low-intensity reciprocity is excluded, not penalised, by design                                                                               |
| 5   | **Griefing a competitor**             | Send it payments from shady wallets      | Unsolicited inflow is only ever _uncredited_, never penalising. The test `unsolicited payments … cannot lower a score` covers this       | Becoming a vendor to someone the victim pays creates a long cycle that can trim the victim's _outflow_ edge, bounded by the attacker's own spend     |
| 6   | **Forged identity links**             | Claim a victim's wallet                  | 8004 `agent_wallet` requires an Ed25519 signature. Fee-payer links need the victim's signature. First-funder is fixed at wallet creation | Dust-funding a not-yet-funded wallet; mitigated by hub caps and the soft-link cap                                                                    |
| 7   | **Facilitator as cluster bridge**     | All x402 payers share a fee payer        | Facilitators are infrastructure, never link evidence. Unknown relayers hit the hub cap                                                   | A new facilitator before it is listed: hub cap (25) still applies                                                                                    |
| 8   | **Address poisoning / dust**          | Tiny transfers to create edges           | Only stablecoin payments count. Dust earns no credit (`$0.10` payer unit)                                                                | Configurable `minPaymentMicros`                                                                                                                      |
| 9   | **Compromised publisher key**         | Writes arbitrary scores                  | Admin can pause and rotate. Roots and hashes make tampering detectable. Consumers bound staleness                                        | Bad scores until rotation, which motivates multi-publisher attestation                                                                               |
| 10  | **Stale scores**                      | Agent turns bad after its last update    | `updated_slot` + `max_age_slots` in every policy                                                                                         | Daily cadence; `BURST` gives early warning                                                                                                           |
| 11  | **Methodology gaming**                | Optimise against the published formula   | Formula is public by design. Defences rely on costs (age, real counterparties), not secrecy                                              | Versioned methodology lets defences evolve, each change visible onchain                                                                              |

## Known limitations of v1

- Non-stablecoin payments (SOL, other SPL tokens) are ignored.
- x402 smart-wallet payments (Path 2, `TransferChecked` via CPI) are not yet classified.
- Funding resolution gives up on wallets with more than 10k signatures and treats them as old. That is the safe default for sybil detection.
- Live gRPC updates carry no block time; receipt time is used, which skews by a few seconds.
- Scores are reproducible, not trustless. See the roadmap in [project-overview.md](project-overview.md).
