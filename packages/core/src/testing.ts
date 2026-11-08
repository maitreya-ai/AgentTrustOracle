import type { EpochInput } from "./epoch";
import { encodeAddress, sha256 } from "./hash";
import type { Address, AgentIdentity, Payment, PaymentRail, WalletProfile } from "./types";

/** Deterministic fake address derived from a label (test/fixture use only). */
export function addr(label: string): Address {
  return encodeAddress(sha256(new TextEncoder().encode(`ato-test:${label}`)));
}

/** Build a payment whose id is derived from its content, so fixtures are reproducible. */
export function pay(
  payer: Address,
  payee: Address,
  usd: number,
  blockTime: number,
  rail: PaymentRail = "x402_exact",
): Payment {
  const micros = BigInt(Math.round(usd * 1_000_000));
  const signature = addr(`${payer}|${payee}|${micros}|${blockTime}|${rail}`);
  const id = `${signature}:0`;
  return {
    id,
    signature,
    slot: blockTime * 2,
    blockTime,
    rail,
    payer,
    payee,
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: micros,
    usdMicros: micros,
  };
}

export const DAY = 86_400;

const AS_OF = 1_790_000_000;
const t = (daysAgo: number, offset = 0) => AS_OF - Math.round(daysAgo * DAY) + offset;

export const SCENARIO_CLOCK = { AS_OF, t };

/**
 * A small synthetic economy with one honest agent and three classic manipulation patterns:
 *
 *   honest     20 aged consumers who also pay two other services, repeat usage over 10 days
 *   washRing   W → R1 → R2 → W, $1k per lap
 *   selfDeal   five sock wallets funded by the agent's own wallet pay it $100 each
 *   sybilFarm  30 fresh wallets from one funder pay the agent $5 each
 */
export function syntheticEconomy(): EpochInput & { payments: Payment[]; wallets: WalletProfile[] } {
  const payments: Payment[] = [];
  const wallets: WalletProfile[] = [];
  const agents: AgentIdentity[] = [];

  const honest = addr("honest");
  const s1 = addr("service1");
  const s2 = addr("service2");
  agents.push({ id: addr("honest-asset"), registry: "8004", wallets: [honest] });
  for (let i = 0; i < 20; i++) {
    const c = addr(`consumer${i}`);
    wallets.push({ address: c, firstSeenAt: t(200) });
    for (let d = 0; d < 10; d++) payments.push(pay(c, honest, 0.05, t(d + 1, i)));
    payments.push(pay(c, s1, 0.5, t(3, i)));
    payments.push(pay(c, s2, 0.5, t(4, i)));
  }

  const w = addr("wash");
  const r1 = addr("ring1");
  const r2 = addr("ring2");
  agents.push({ id: addr("wash-asset"), registry: "8004", wallets: [w] });
  for (let lap = 0; lap < 10; lap++) {
    payments.push(pay(w, r1, 1_000, t(lap + 1, 1)));
    payments.push(pay(r1, r2, 1_000, t(lap + 1, 2)));
    payments.push(pay(r2, w, 1_000, t(lap + 1, 3)));
  }

  const dealer = addr("dealer");
  agents.push({
    id: addr("dealer-asset"),
    registry: "8004",
    wallets: [dealer],
    owner: addr("dealer-owner"),
  });
  for (let i = 0; i < 5; i++) {
    const sock = addr(`sock${i}`);
    wallets.push({ address: sock, firstSeenAt: t(20), firstFunder: dealer });
    payments.push(pay(sock, dealer, 100, t(i + 1)));
  }

  const farmAgent = addr("farm");
  const farmFunder = addr("farm-funder");
  agents.push({ id: addr("farm-asset"), registry: "8004", wallets: [farmAgent] });
  for (let i = 0; i < 30; i++) {
    const y = addr(`farm-payer${i}`);
    wallets.push({ address: y, firstSeenAt: t(2), firstFunder: farmFunder });
    payments.push(pay(y, farmAgent, 5, t(1, i)));
  }

  return { epoch: 1n, asOf: AS_OF, payments, links: [], wallets, agents };
}
