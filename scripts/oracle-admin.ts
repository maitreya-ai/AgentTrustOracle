/**
 * Governance / ops CLI for a deployed trust-oracle program.
 *
 *   bun run oracle status
 *   bun run oracle init                    # admin = upgrade authority, publisher from PUBLISHER_KEYPAIR_PATH
 *   bun run oracle pause | unpause
 *   bun run oracle set-publisher <address>
 *
 * Env: SOLANA_RPC_URL, ADMIN_KEYPAIR_PATH (default ~/.config/solana/id.json),
 *      PUBLISHER_KEYPAIR_PATH, ORACLE_PROGRAM_ID (optional).
 */
import {
  fetchOracleConfig,
  fetchScoreEpoch,
  getInitializeInstruction,
  getUpdateConfigInstruction,
  sendInstructions,
  TRUST_ORACLE_PROGRAM_ID,
} from "@ato/sdk";
import { loadKeypairSigner } from "@ato/sdk/node";
import { type Address, address, createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(
  process.env.SOLANA_WS_URL ?? rpcUrl.replace(/^http/, "ws"),
);
const programId = (
  process.env.ORACLE_PROGRAM_ID ? address(process.env.ORACLE_PROGRAM_ID) : TRUST_ORACLE_PROGRAM_ID
) as Address;
const [command, arg] = process.argv.slice(2);
const admin = () => loadKeypairSigner(process.env.ADMIN_KEYPAIR_PATH ?? "~/.config/solana/id.json");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

switch (command) {
  case "status": {
    const c = await fetchOracleConfig(rpc, programId);
    if (!c) {
      console.log(`program ${programId}: not initialized`);
      break;
    }
    console.log({
      programId,
      ...c,
      latestEpoch: c.latestEpoch.toString(),
      latestEpochAt: c.latestEpochAt.toString(),
      scoreAccounts: c.scoreAccounts.toString(),
    });
    if (c.latestEpoch > 0n) {
      const e = await fetchScoreEpoch(rpc, c.latestEpoch, programId);
      if (e)
        console.log({
          epoch: e.epoch.toString(),
          merkleRoot: hex(e.merkleRoot),
          methodologyHash: hex(e.methodologyHash),
          agentCount: e.agentCount,
        });
    }
    break;
  }
  case "init": {
    const signer = await admin();
    const publisherPath = process.env.PUBLISHER_KEYPAIR_PATH;
    if (!publisherPath) throw new Error("PUBLISHER_KEYPAIR_PATH is required");
    const publisher = (await loadKeypairSigner(publisherPath)).address;
    const ix = await getInitializeInstruction({
      admin: signer,
      publisher,
      methodologyVersion: 1,
      programId,
    });
    console.log(`initialized: ${await sendInstructions({ rpc, rpcSubscriptions }, signer, [ix])}`);
    break;
  }
  case "pause":
  case "unpause": {
    const signer = await admin();
    const ix = await getUpdateConfigInstruction({
      admin: signer,
      paused: command === "pause",
      programId,
    });
    console.log(`${command}d: ${await sendInstructions({ rpc, rpcSubscriptions }, signer, [ix])}`);
    break;
  }
  case "set-publisher": {
    if (!arg) throw new Error("usage: set-publisher <address>");
    const signer = await admin();
    const ix = await getUpdateConfigInstruction({
      admin: signer,
      publisher: address(arg),
      programId,
    });
    console.log(
      `publisher rotated: ${await sendInstructions({ rpc, rpcSubscriptions }, signer, [ix])}`,
    );
    break;
  }
  default:
    console.error("usage: oracle <status|init|pause|unpause|set-publisher <addr>>");
    process.exit(1);
}
process.exit(0);
