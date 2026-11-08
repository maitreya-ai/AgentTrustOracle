import type { DemoRow } from "@/lib/demo";

function tone(score: number) {
  if (score >= 600)
    return { text: "text-sol-green", bar: "bg-sol-green", ring: "ring-sol-green/30", tier: "Gold" };
  if (score >= 200)
    return {
      text: "text-amber-300",
      bar: "bg-amber-300",
      ring: "ring-amber-300/30",
      tier: "Bronze",
    };
  return { text: "text-rose-400", bar: "bg-rose-400", ring: "ring-rose-400/30", tier: "Untrusted" };
}

export function ScoreRow({ row }: { row: DemoRow }) {
  const t = tone(row.score);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{row.label}</p>
        <p className="truncate text-xs text-zinc-500">{row.pattern}</p>
      </div>
      <div className="text-right">
        <p className={`font-mono text-2xl font-semibold tabular-nums ${t.text}`}>{row.score}</p>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">/ 1000</p>
      </div>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${t.bar}`}
          style={{ width: `${Math.max(1.5, row.score / 10)}%` }}
        />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-mono text-zinc-400">
          ${row.rawUsd.toLocaleString()} raw → $
          {row.creditedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} credited
        </span>
        {row.payerWallets !== row.payerEntities ? (
          <span className="font-mono text-zinc-500">
            · {row.payerWallets} wallets → {row.payerEntities} entity
          </span>
        ) : null}
        {row.flags.map((f) => (
          <span key={f} className={`rounded-md px-1.5 py-0.5 font-mono ring-1 ${t.ring} ${t.text}`}>
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}
