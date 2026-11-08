import type { ReactNode } from "react";

export const GITHUB = "https://github.com/maitreya-ai/AgentTrustOracle";
export const doc = (name: string) => `${GITHUB}/blob/main/docs/${name}.md`;

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-sol-teal">{eyebrow}</p>
      <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {intro ? <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">{intro}</p> : null}
      <div className="mt-12">{children}</div>
    </section>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.025] shadow-[0_0_0_1px_rgba(0,0,0,0.3)] ${padded ? "p-6" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-zinc-300">
      {children}
    </span>
  );
}

export function ExternalLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path
        d="M32 6 52 14v16c0 13-8.4 22.4-20 26-11.6-3.6-20-13-20-26V14z"
        fill="none"
        stroke="url(#logo-g)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="m22 31 7 7 13.5-13.5"
        fill="none"
        stroke="url(#logo-g)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS = {
  index: "M4 6h16M4 12h10M4 18h7m9-3-3 3-3-3m3 3v-8",
  cluster: "M7 7a3 3 0 1 0 0 .01M17 7a3 3 0 1 0 0 .01M12 17a3 3 0 1 0 0 .01M9 9l2 5m4-5-2 5",
  cycle: "M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18 3v4.5h-4.5M6 21v-4.5h4.5",
  rank: "M4 20V10m6 10V4m6 16v-7m6 7H2",
  chain:
    "M9 15 15 9m-7.5-.5L6 10a4 4 0 0 0 5.7 5.7l1.5-1.5m3.3-3.7L18 9a4 4 0 0 0-5.7-5.7l-1.5 1.5",
  shield: "M12 3 20 6v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6zm-3.5 9 2.5 2.5L15.5 10",
  repeat: "M4 7h13l-3-3m3 3-3 3M20 17H7l3 3m-3-3 3-3",
  id: "M4 5h16v14H4zM8 10a2 2 0 1 0 0 .01M6 15c.6-1.5 1.8-2 2-2s1.4.5 2 2m3-6h4m-4 3h4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  github:
    "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.84c.85 0 1.7.11 2.5.33 1.9-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2",
} as const;

export function Icon({
  name,
  className = "size-5",
}: {
  name: keyof typeof ICONS;
  className?: string;
}) {
  const filled = name === "github";
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
