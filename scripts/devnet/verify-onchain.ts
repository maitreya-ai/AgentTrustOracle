/**
 * Check a published score from the consumer's side, on a live cluster:
 *   1. read the AgentScore account and decode it,
 *   2. check the account's Merkle leaf against the onchain epoch root (offchain),
 *   3. send `verify_score_proof` and a permissive `assert_trust` (both must land),
 *   4. simulate `assert_trust` with the STANDARD policy and report the verdict.
 *
 *   bun run scripts/devnet/verify-onchain.ts <agent-id>
 */
import { hashLeaf, verifyProof } from "@ato/core";
import { createDb, createRepo } from "@ato/db";
import {
  checkTrust,
  fetchAgentScore,
  fetchOracleConfig,
  fetchScoreEpoch,
  getAssertTrustInstruction,
  getVerifyScoreProofInstruction,
  POLICIES,
  sendInstructions,
} from "@ato/sdk";
import { loadKeypairSigner } from "@ato/sdk/node";
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  type Instruction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

const agent = address(process.argv[2] ?? "");
const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, "ws"));
const payer = await loadKeypairSigner(process.env.ADMIN_KEYPAIR_PATH ?? "~/.config/solana/id.json");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

const config = await fetchOracleConfig(rpc);
const score = await fetchAgentScore(rpc, agent);
if (!config || !score) throw new Error("oracle not initialised or no AgentScore for this agent");
const epoch = await fetchScoreEpoch(rpc, score.epoch);
if (!epoch) throw new Error(`epoch ${score.epoch} missing`);
const { value: slot } = { value: await rpc.getSlot().send() };
console.log("AgentScore", {
  agent: score.agent,
  score: score.score,
  confidence: score.confidence,
  flags: score.flags,
  organicUsd: Number(score.organicVolume) / 1e6,
  epoch: score.epoch.toString(),
  ageSlots: (slot - score.updatedSlot).toString(),
});

// Offchain: the materialised account must be the leaf committed in the epoch root.
const row = await createRepo(createDb()).latestScore(agent);
const proof = (row?.proof ?? []).map(fromHex);
const leaf = {
  agent,
  registry: score.registry,
  epoch: score.epoch,
  score: score.score,
  confidence: score.confidence,
  flags: score.flags,
  washRatioBps: score.washRatioBps,
  uniquePayers: score.uniquePayers,
  organicVolume: score.organicVolume,
};
console.log(
  "leaf in onchain root (offchain check):",
  verifyProof(hashLeaf(leaf), proof, epoch.merkleRoot),
);

// Onchain: both instructions must succeed.
const proofIx = await getVerifyScoreProofInstruction({ leaf, proof });
const permissive = await getAssertTrustInstruction({
  agent,
  policy: { minScore: 0, minConfidence: 0, maxAgeSlots: 0n, forbiddenFlags: 0 },
});
console.log(
  "verify_score_proof + assert_trust(permissive):",
  await sendInstructions({ rpc, rpcSubscriptions }, payer, [proofIx, permissive]),
);

// Simulate the STANDARD policy and compare with the SDK's offchain verdict.
async function simulate(ixs: Instruction[]) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  const res = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64" })
    .send();
  return { err: res.value.err, log: res.value.logs?.find((l) => l.includes("Error Message")) };
}
const standard = await simulate([
  await getAssertTrustInstruction({ agent, policy: POLICIES.STANDARD }),
]);
console.log(
  "assert_trust(STANDARD) onchain:",
  standard.err ? `rejected: ${standard.log ?? JSON.stringify(standard.err)}` : "passed",
);
console.log(
  "checkTrust(STANDARD) offchain:",
  checkTrust(score, POLICIES.STANDARD, slot) ?? "passed",
);
process.exit(0);
