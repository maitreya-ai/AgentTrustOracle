import { Code } from "@/components/code";
import { ScoreRow } from "@/components/score-card";
import { Card, doc, ExternalLink, GITHUB, Icon, Logo, Pill, Section } from "@/components/ui";
import { demo } from "@/lib/demo";
import { type DevnetSnapshot, devnetSnapshot, explorer, PROGRAM_ID } from "@/lib/devnet";

// Re-read the deployed program every 5 minutes.
export const revalidate = 300;

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const short = (s: string, n = 6) => `${s.slice(0, n)}…${s.slice(-n)}`;

export default async function Page() {
  const d = demo();
  const live = await devnetSnapshot();
  return (
    <>
      <Nav />
      <main>
        <Hero live={live} rows={d.rows} />
        <Problem stats={d.stats} />
        <HowItWorks />
        <Principles />
        <Builders />
        <Api />
        <Devnet live={live} />
        <Roadmap />
      </main>
      <Footer />
    </>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-ink/75 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-sm font-semibold tracking-tight text-white">
            Agent Trust Oracle
          </span>
        </a>
        <div className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          <a href="#how" className="transition hover:text-white">
            How it works
          </a>
          <a href="#builders" className="transition hover:text-white">
            Builders
          </a>
          <a href="#api" className="transition hover:text-white">
            API
          </a>
          <a href="#devnet" className="transition hover:text-white">
            Devnet
          </a>
        </div>
        <ExternalLink
          href={GITHUB}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.08]"
        >
          <Icon name="github" className="size-4" />
          GitHub
        </ExternalLink>
      </nav>
    </header>
  );
}

function Hero({
  live,
  rows,
}: {
  live: DevnetSnapshot | null;
  rows: ReturnType<typeof demo>["rows"];
}) {
  return (
    <div id="top" className="relative overflow-hidden">
      <div className="glow pointer-events-none absolute inset-0" />
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-6xl gap-14 px-4 pt-20 pb-24 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-28">
        <div>
          <Pill>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sol-green opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-sol-green" />
            </span>
            {live ? `Live on Solana devnet · epoch ${live.latestEpoch}` : "Built on Solana"}
          </Pill>
          <h1 className="mt-6 text-5xl leading-[1.05] font-semibold tracking-tight text-white sm:text-6xl">
            Trust scores agents <span className="text-gradient">can&apos;t buy.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-400">
            Agent Trust Oracle scores Solana agents by the money they actually earn from credible,
            unrelated counterparties. Wash trading and self-dealing are stripped out, and every
            score is published onchain, readable by any program in one account load.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#builders"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-medium text-ink transition hover:bg-zinc-200"
            >
              Integrate in two lines
              <Icon name="arrow" className="size-4" />
            </a>
            <ExternalLink
              href={doc("architecture")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.04]"
            >
              Read the architecture
            </ExternalLink>
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/[0.06] pt-6">
            {[
              ["x402 + channels", "settlement rails"],
              ["ERC-8004", "identity source"],
              ["0 CPI", "to read a score"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm font-semibold text-white">{k}</dt>
                <dd className="mt-1 text-xs text-zinc-500">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-sol-purple/20 via-transparent to-sol-green/10 blur-2xl" />
          <div className="relative rounded-3xl border border-white/10 bg-panel/90 p-5 shadow-2xl shadow-black/50 backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-mono text-xs text-zinc-400">runEpoch(syntheticEconomy())</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                real engine output
              </p>
            </div>
            <div className="space-y-2.5">
              {rows.map((r) => (
                <ScoreRow key={r.label} row={r} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Problem({ stats }: { stats: ReturnType<typeof demo>["stats"] }) {
  const parts = [
    { label: "Wash rings", value: stats.washUsd, color: "bg-rose-400" },
    { label: "Self-dealing", value: stats.selfDealingUsd, color: "bg-amber-300" },
    { label: "Organic", value: stats.organicUsd, color: "bg-sol-green" },
  ];
  return (
    <Section
      eyebrow="The problem"
      title="Raw agent volume is mostly noise."
      intro={
        <>
          Faking agent payment volume costs a few dollars in fees, and ratings are cheaper still.
          Analysts filtering x402 activity for self-transfers and circular flows found adjusted
          volume to be a small fraction of raw counts (
          <ExternalLink
            className="text-zinc-200 underline decoration-white/20 underline-offset-4 hover:decoration-white"
            href="https://startupfortune.com/ai-agents-have-moved-over-200-million-payments-on-x402-but-half-may-be-fake/"
          >
            Visa–Artemis
          </ExternalLink>
          ). Anyone deciding whether to trust an agent needs the part that is real.
        </>
      }
    >
      <Card padded={false} className="p-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm text-zinc-400">Demo economy, scored by the production engine</p>
            <p className="mt-2 font-mono text-5xl font-semibold tracking-tight text-white tabular-nums">
              {stats.organicShare.toFixed(1)}%
              <span className="ml-3 text-base font-normal text-zinc-500">
                of raw volume is organic
              </span>
            </p>
          </div>
          <p className="font-mono text-sm text-zinc-400">
            {usd(stats.rawUsd)} raw →{" "}
            <span className="text-sol-green">{usd(stats.organicUsd)}</span> organic
          </p>
        </div>
        <div className="mt-8 flex h-4 overflow-hidden rounded-full bg-white/[0.05]">
          {parts.map((p) => (
            <div
              key={p.label}
              className={p.color}
              style={{ width: `${Math.max(0.8, (p.value / stats.rawUsd) * 100)}%` }}
              title={`${p.label}: ${usd(p.value)}`}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {parts.map((p) => (
            <div key={p.label} className="flex items-center gap-2 text-zinc-400">
              <span className={`size-2.5 rounded-sm ${p.color}`} />
              {p.label}
              <span className="font-mono text-zinc-200">{usd(p.value)}</span>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}

const STEPS = [
  {
    icon: "index",
    title: "Index settlements",
    body: "x402 exact, Solana payment channels (upto / MPP session) and agent-wallet transfers, classified per rail.",
  },
  {
    icon: "cluster",
    title: "Resolve entities",
    body: "Wallets linked by registry ownership, funding source, fee sponsorship or rent become one entity. Self-payments drop out.",
  },
  {
    icon: "cycle",
    title: "Cancel cycles",
    body: "Money that comes back around is removed. Tight loops are flagged as wash rings; loose ones are just excluded.",
  },
  {
    icon: "rank",
    title: "Weigh credibility",
    body: "TrustRank seeded by aged wallets that pay many services. A fresh sock wallet's dollar barely counts.",
  },
  {
    icon: "chain",
    title: "Commit onchain",
    body: "Per-epoch Merkle root, methodology and inputs hashes, plus per-agent accounts for zero-CPI reads.",
  },
] as const;

function HowItWorks() {
  return (
    <Section
      id="how"
      eyebrow="How it works"
      title="Count net, credible demand. Nothing else."
      intro="A deterministic pipeline turns settled payments into scores. Same inputs, same methodology, same Merkle root, so anyone can reproduce an epoch."
    >
      <ol className="grid gap-4 md:grid-cols-5">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5"
          >
            <div className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-sol-purple/25 to-sol-green/10 text-zinc-100 ring-1 ring-white/10">
                <Icon name={s.icon} />
              </span>
              <span className="font-mono text-xs text-zinc-600">0{i + 1}</span>
            </div>
            <h3 className="mt-5 text-sm font-semibold text-white">{s.title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{s.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Principles() {
  const items = [
    {
      icon: "shield",
      title: "Griefing-resistant",
      body: "A payment you didn't reciprocate can never lower your score. Only an agent's own flows can penalise it, and that property is tested.",
    },
    {
      icon: "repeat",
      title: "Reproducible",
      body: "Every epoch commits its methodology hash, inputs hash and Merkle root. Re-run the open pipeline and compare.",
    },
    {
      icon: "id",
      title: "No new identity silo",
      body: "Reads the ERC-8004 Agent Registry (SATI next) through a pluggable provider, and can sit under any agent network.",
    },
  ] as const;
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((it) => (
          <Card key={it.title}>
            <Icon name={it.icon} className="size-6 text-sol-teal" />
            <h3 className="mt-4 font-semibold text-white">{it.title}</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{it.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

const RUST = `
use trust_oracle_interface::{erc8004, load_checked, TrustPolicy};

// 1. The signer controls a registered 8004 agent.
let agent = erc8004::parse_agent(&agent_info.owner.to_bytes(), &agent_data)
    .ok_or(MyError::NotAnAgent)?;
require!(agent.is_controlled_by(&signer.key().to_bytes()), MyError::NotTheAgent);

// 2. The oracle vouches for it right now. No CPI, no Anchor dependency.
let score = load_checked(&score_info.owner.to_bytes(), &score_data, &agent.asset)?;
TrustPolicy::STANDARD.check(&score, Clock::get()?.slot)?;
`;

const TS = `
import { checkTrust, createTrustOracleClient, fetchAgentScore, POLICIES } from "@ato/sdk";
import { createX402Fetch } from "@ato/sdk/x402";

// Onchain, free
const score = await fetchAgentScore(rpc, agentId);
const verdict = checkTrust(score, POLICIES.STANDARD, slot); // null = trusted

// API, paid per request with x402 (USDC on Solana)
const oracle = createTrustOracleClient({ baseUrl, paidFetch: createX402Fetch(signer) });
const report = await oracle.report(agentId);
`;

function Builders() {
  const paths = [
    ["Zero-CPI read", "Pass the AgentScore account and check it with the no_std interface crate."],
    ["CPI", "Call assert_trust(policy) from any Anchor program."],
    [
      "Guard instruction",
      "Prepend assert_trust so the whole transaction reverts if trust dropped.",
    ],
    ["Merkle proof", "verify_score_proof covers every agent in an epoch, materialised or not."],
  ];
  return (
    <Section
      id="builders"
      eyebrow="For builders"
      title="One account read. No CPI."
      intro="Gate credit lines, agents-only pools or marketplace listings on earned trust. The score account has a fixed 128-byte layout shared by the program, the Rust interface crate and the TypeScript SDK, all verified against the same fixtures."
    >
      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <ul className="space-y-3">
          {paths.map(([title, body]) => (
            <li
              key={title}
              className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <Icon name="check" className="mt-0.5 size-5 shrink-0 text-sol-green" />
              <div>
                <p className="text-sm font-medium text-white">{title}</p>
                <p className="mt-1 text-sm leading-6 text-zinc-400">{body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="space-y-4">
          <Code title="programs/your-protocol/src/lib.rs" lang="rust" code={RUST} />
          <Code title="agent.ts" lang="typescript" code={TS} />
        </div>
      </div>
    </Section>
  );
}

function Api() {
  const tiers = [
    {
      name: "Free",
      price: "$0",
      items: ["Tier badges", "Merkle proofs", "Latest epoch", "Ecosystem stats"],
      highlight: false,
    },
    {
      name: "Score",
      price: "$0.001",
      items: ["Score, confidence, flags", "Organic vs raw volume", "Wallet → agent lookup"],
      highlight: true,
    },
    {
      name: "Report",
      price: "$0.01",
      items: ["Score components", "Linked wallets", "Wash-cycle evidence"],
      highlight: false,
    },
    { name: "Batch", price: "$0.02", items: ["Up to 50 agents", "One payment"], highlight: false },
  ];
  return (
    <Section
      id="api"
      eyebrow="Score API"
      title="Pay per request with x402. No API keys."
      intro="Unpaid requests get HTTP 402 with a payment challenge. Agents pay a fraction of a cent in USDC on Solana and retry. Onchain scores stay free for every program to read."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((t) => (
          <div
            key={t.name}
            className={`rounded-2xl border p-6 ${
              t.highlight
                ? "border-sol-purple/40 bg-gradient-to-b from-sol-purple/15 to-transparent"
                : "border-white/[0.08] bg-white/[0.02]"
            }`}
          >
            <p className="text-sm text-zinc-400">{t.name}</p>
            <p className="mt-2 font-mono text-3xl font-semibold text-white">{t.price}</p>
            <p className="text-xs text-zinc-500">{t.price === "$0" ? "forever" : "per request"}</p>
            <ul className="mt-6 space-y-2 text-sm text-zinc-300">
              {t.items.map((i) => (
                <li key={i} className="flex items-center gap-2">
                  <Icon name="check" className="size-4 text-sol-teal" />
                  {i}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Devnet({ live }: { live: DevnetSnapshot | null }) {
  const verified = [
    "4,917 agents synced from the live 8004 registry",
    "Real x402 payments settled by the PayAI facilitator and classified",
    "356 payment-channel payouts decoded from devnet traffic",
    "Epochs published; proofs and assert_trust verified onchain",
  ];
  const rows: [string, string, string?][] = live
    ? [
        ["Program", short(PROGRAM_ID, 8), explorer(PROGRAM_ID)],
        ["Latest epoch", live.latestEpoch],
        ["Agents in root", live.agentCount.toLocaleString()],
        ["Merkle root", short(live.merkleRoot, 10)],
        ["Methodology", short(live.methodologyHash, 10)],
        ["Published", `${live.publishedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`],
      ]
    : [["Program", short(PROGRAM_ID, 8), explorer(PROGRAM_ID)]];
  return (
    <Section
      id="devnet"
      eyebrow="Live on devnet"
      title="Deployed, published, verified."
      intro="This panel is read from the deployed program when the page renders, not hard-coded."
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card padded={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
            <p className="text-sm font-medium text-white">trust-oracle · devnet</p>
            <span className="inline-flex items-center gap-2 font-mono text-xs text-sol-green">
              <span className="size-1.5 rounded-full bg-sol-green" />
              {live ? (live.paused ? "paused" : "active") : "rpc unavailable"}
            </span>
          </div>
          <dl className="divide-y divide-white/[0.05]">
            {rows.map(([k, v, href]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-6 py-3.5">
                <dt className="text-sm text-zinc-500">{k}</dt>
                <dd className="font-mono text-sm text-zinc-200">
                  {href ? (
                    <ExternalLink
                      href={href}
                      className="underline decoration-white/20 underline-offset-4 hover:decoration-white"
                    >
                      {v}
                    </ExternalLink>
                  ) : (
                    v
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <p className="text-sm font-medium text-white">Verified end to end on devnet</p>
          <ul className="mt-5 space-y-4">
            {verified.map((v) => (
              <li key={v} className="flex gap-3 text-sm leading-6 text-zinc-300">
                <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-sol-green/15">
                  <Icon name="check" className="size-3.5 text-sol-green" />
                </span>
                {v}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

function Roadmap() {
  const items = [
    ["Now", "Devnet MVP", "Indexer, scorer, publisher, x402 API, program and interface crate."],
    [
      "Next",
      "Mainnet indexing",
      "gRPC ingestion of facilitators and channels; a public organic-volume stat.",
    ],
    [
      "Then",
      "Staked attestation",
      "Multiple staked publishers sign the same root, with a dispute window.",
    ],
    [
      "Later",
      "zk-proven epochs",
      "Prove runEpoch over committed inputs; write back to the 8004 Reputation Registry.",
    ],
  ];
  return (
    <Section eyebrow="Roadmap" title="From reproducible to trustless.">
      <div className="grid gap-4 md:grid-cols-4">
        {items.map(([when, title, body]) => (
          <div key={title} className="border-t border-white/10 pt-5">
            <p className="font-mono text-xs uppercase tracking-widest text-sol-purple">{when}</p>
            <p className="mt-3 font-semibold text-white">{title}</p>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
          </div>
        ))}
      </div>
      <div className="mt-16 flex flex-col items-start justify-between gap-6 rounded-3xl border border-white/10 bg-gradient-to-br from-sol-purple/15 via-panel to-sol-green/10 p-8 sm:flex-row sm:items-center sm:p-10">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-white">Build on earned trust.</p>
          <p className="mt-2 text-zinc-400">
            Open source. Read the methodology, run the tests, integrate in an afternoon.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ExternalLink
            href={GITHUB}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-medium text-ink transition hover:bg-zinc-200"
          >
            <Icon name="github" className="size-4" />
            Star on GitHub
          </ExternalLink>
          <ExternalLink
            href={doc("methodology")}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.05]"
          >
            Methodology
          </ExternalLink>
        </div>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo className="size-5" />
          <span>Agent Trust Oracle · built on Solana · x402 · ERC-8004</span>
        </div>
        <div className="flex gap-6">
          <ExternalLink href={doc("project-overview")} className="hover:text-zinc-300">
            Overview
          </ExternalLink>
          <ExternalLink href={doc("architecture")} className="hover:text-zinc-300">
            Architecture
          </ExternalLink>
          <ExternalLink href={doc("methodology")} className="hover:text-zinc-300">
            Methodology
          </ExternalLink>
          <ExternalLink href={GITHUB} className="hover:text-zinc-300">
            GitHub
          </ExternalLink>
        </div>
      </div>
    </footer>
  );
}
