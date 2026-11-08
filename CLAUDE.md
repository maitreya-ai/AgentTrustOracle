# Agent Trust Oracle

Payment-grounded trust scores for Solana agents. Bun monorepo (TypeScript) + Anchor 1.2 program (Rust).

## Commands

- `bun install` · `bun run check` (biome + tsc + bun test) · `cargo test --workspace`
- `bun run simulate`: score the synthetic economy and print the table (sanity-check methodology changes)
- `bun run fixtures`: regenerate cross-language parity fixtures. Run after ANY layout change, then `cargo test`
- `bun run program:keys`: sync program ids into declare_id!/Anchor.toml/interface crate/SDK (`--check` in CI)
- DB: `bun run db:up` (docker, port 5433) → `bun run db:migrate` → `bun run demo:seed` → `bun run score`
- Program: `cargo build-sbf --manifest-path programs/trust-oracle/Cargo.toml` then `REQUIRE_SBF=1 cargo test -p program-tests`
- Devnet ops: `bun run oracle status|init|pause|set-publisher`; scripts in `scripts/devnet/` (pay API over x402, verify onchain)
- Web: `bun run dev:web` · `bun run build:web` (also typechecks web with TS 6, since Next needs the TS JS API) · `bun run screenshots`

## Layout

- `packages/core`: pure, deterministic scoring (entities, cycles, TrustRank, Merkle). No Solana deps.
- `packages/solana`: tx normalisation + classifiers (x402 exact, payment channels, direct), 8004 registry, funding.
- `packages/db`: Drizzle schema/repo on Bun.SQL. `packages/sdk`: client (accounts, PDAs, ix builders, x402 API client).
- `apps/{indexer,scorer,publisher,api,web}` (web = Next.js landing page; excluded from root tsconfig); `programs/trust-oracle`; `crates/trust-oracle-interface` (zero-dep reader);
  `examples/trust-gated-vault`; `tests/program` (LiteSVM).

## Invariants (don't break)

- `AgentScore` layout (128 bytes) and Merkle leaf encoding (64 bytes) are a public contract shared by Rust interface,
  Anchor program and TS SDK. Append-only via `reserved`; bump version; regenerate fixtures.
- `runEpoch` must stay deterministic (sorted iteration, no Date.now/Math.random inside).
- Scores must stay monotone in unsolicited inflow: only flows an agent participates in may penalise it.
- Any methodology tweak changes `methodologyHash`; bump `METHODOLOGY_V1.version` → new methodology.
- Cargo.lock is seeded from Anchor's LiteSVM template (agave 4.1.x) to stay on rustc 1.89; don't `cargo update` blindly.

See docs/architecture.md, docs/methodology.md, docs/project-overview.md.
