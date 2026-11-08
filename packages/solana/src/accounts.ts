import type { Address } from "@ato/core";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { type Cluster, PROGRAMS, STABLECOINS } from "./programs";

const enc = getAddressEncoder();

export async function associatedTokenAddress(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(PROGRAMS.associatedToken),
    seeds: [
      enc.encode(address(owner)),
      enc.encode(address(tokenProgram)),
      enc.encode(address(mint)),
    ],
  });
  return ata;
}

/**
 * The addresses that actually appear in a wallet's incoming stablecoin payments.
 *
 * An x402 / SPL transfer references the recipient's token account, not the wallet itself,
 * so `getSignaturesForAddress(wallet)` misses inbound payments. Watch the ATAs too.
 */
export async function paymentAddresses(cluster: Cluster, wallet: Address): Promise<Address[]> {
  const atas = await Promise.all(
    Object.entries(STABLECOINS[cluster]).map(([mint, coin]) =>
      associatedTokenAddress(wallet, mint, coin.tokenProgram),
    ),
  );
  return [wallet, ...atas];
}
