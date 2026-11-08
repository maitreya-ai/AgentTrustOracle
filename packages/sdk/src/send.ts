import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createTransactionMessage,
  type GetEpochInfoApi,
  type GetLatestBlockhashApi,
  type GetSignatureStatusesApi,
  getSignatureFromTransaction,
  type Instruction,
  pipe,
  type Rpc,
  type RpcSubscriptions,
  type SendTransactionApi,
  type SignatureNotificationsApi,
  type SlotNotificationsApi,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";

export interface SendContext {
  rpc: Rpc<SendTransactionApi & GetLatestBlockhashApi & GetSignatureStatusesApi & GetEpochInfoApi>;
  rpcSubscriptions: RpcSubscriptions<SignatureNotificationsApi & SlotNotificationsApi>;
}

/** Build, sign (with every signer referenced by the instructions) and confirm a v0 tx. */
export async function sendInstructions(
  ctx: SendContext,
  feePayer: TransactionSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: blockhash } = await ctx.rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(tx);
  await sendAndConfirmTransactionFactory(ctx)(tx, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}
