import { fetchOracleConfig, fetchScoreEpoch, TRUST_ORACLE_PROGRAM_ID } from "@ato/sdk";
import { createSolanaRpc } from "@solana/kit";

export const PROGRAM_ID = TRUST_ORACLE_PROGRAM_ID;
export const explorer = (address: string) =>
  `https://explorer.solana.com/address/${address}?cluster=devnet`;

export interface DevnetSnapshot {
  latestEpoch: string;
  agentCount: number;
  scoreAccounts: string;
  merkleRoot: string;
  methodologyHash: string;
  publishedAt: Date;
  publisher: string;
  paused: boolean;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Read the deployed oracle's live state. Null if the RPC is unreachable (page still renders). */
export async function devnetSnapshot(): Promise<DevnetSnapshot | null> {
  try {
    const rpc = createSolanaRpc(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
    const config = await fetchOracleConfig(rpc);
    if (!config || config.latestEpoch === 0n) return null;
    const epoch = await fetchScoreEpoch(rpc, config.latestEpoch);
    if (!epoch) return null;
    return {
      latestEpoch: config.latestEpoch.toString(),
      agentCount: epoch.agentCount,
      scoreAccounts: config.scoreAccounts.toString(),
      merkleRoot: hex(epoch.merkleRoot),
      methodologyHash: hex(epoch.methodologyHash),
      publishedAt: new Date(Number(epoch.publishedAt) * 1000),
      publisher: epoch.publisher,
      paused: config.paused,
    };
  } catch {
    return null;
  }
}
