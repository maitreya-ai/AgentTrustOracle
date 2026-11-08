/**
 * Create (idempotently) the devnet USDC token account for an owner, paid by the admin key.
 * x402 payees need one before they can receive payments.
 *
 *   bun run scripts/devnet/ensure-usdc-ata.ts <owner>
 */
import { sendInstructions } from "@ato/sdk";
import { loadKeypairSigner } from "@ato/sdk/node";
import { address, createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

const DEVNET_USDC = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const owner = address(process.argv[2] ?? "");
const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, "ws"));
const payer = await loadKeypairSigner(process.env.ADMIN_KEYPAIR_PATH ?? "~/.config/solana/id.json");

const [ata] = await findAssociatedTokenPda({
  owner,
  mint: DEVNET_USDC,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});
const ix = await getCreateAssociatedTokenIdempotentInstructionAsync({
  payer,
  owner,
  mint: DEVNET_USDC,
});
const sig = await sendInstructions({ rpc, rpcSubscriptions }, payer, [ix]);
console.log(`USDC ATA for ${owner}: ${ata} (${sig})`);
process.exit(0);
