import type { ReactNode } from "react";

const RULES: [RegExp, string][] = [
  [/^\/\/.*/, "text-zinc-500"],
  [/^"(?:[^"\\]|\\.)*"/, "text-emerald-300"],
  [
    /^(?:use|let|fn|pub|const|await|import|from|return|if|new|true|false|impl|mut|as|async|type)\b/,
    "text-violet-300",
  ],
  [/^[A-Z][A-Za-z0-9_]*/, "text-sky-300"],
  [/^[a-z_][A-Za-z0-9_]*(?=\()/, "text-amber-200"],
  [/^\d[\d_]*/, "text-orange-300"],
];

/** Tiny line highlighter for the handful of Rust/TS snippets on the page (no runtime JS). */
function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let i = 0;
  let k = 0;
  const flush = () => {
    if (plain) out.push(plain);
    plain = "";
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const prev = line[i - 1] ?? " ";
    const wordStart = !/[A-Za-z0-9_]/.test(prev);
    const rule = RULES.find(([re], idx) => (idx < 2 || wordStart) && re.test(rest));
    if (rule) {
      const m = rest.match(rule[0])?.[0] ?? "";
      flush();
      out.push(
        <span key={k++} className={rule[1]}>
          {m}
        </span>,
      );
      i += m.length;
    } else {
      plain += line[i];
      i++;
    }
  }
  flush();
  return out;
}

export function Code({ title, lang, code }: { title: string; lang: string; code: string }) {
  const lines = code.trim().split("\n");
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-panel">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-white/10" />
          <span className="size-2.5 rounded-full bg-white/10" />
          <span className="size-2.5 rounded-full bg-white/10" />
          <span className="ml-2 font-mono text-xs text-zinc-400">{title}</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          {lang}
        </span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-zinc-300">
        <code>
          {lines.map((line, n) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static snippet lines never reorder
            <div key={n}>{line ? highlight(line) : " "}</div>
          ))}
        </code>
      </pre>
    </div>
  );
}
