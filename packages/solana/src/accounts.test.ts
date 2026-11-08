import { describe, expect, test } from "bun:test";
import { associatedTokenAddress, paymentAddresses } from "./accounts";
import { PROGRAMS } from "./programs";

describe("payment addresses", () => {
  test("derives the canonical USDC ATA (verified on devnet)", async () => {
    // Created on devnet by scripts/devnet/ensure-usdc-ata.ts for the oracle's deployer.
    const ata = await associatedTokenAddress(
      "EBRNhGViU4PET5vyRpvTzgTCo3twsNEcbMRyiZCAWL7",
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      PROGRAMS.splToken,
    );
    expect(ata).toBe("6bJc6r57Av4eVSSRPbfjjXKWybvq523LkaJkRHX2kSYp");
  });

  test("includes the wallet plus one ATA per cluster stablecoin", async () => {
    expect(
      await paymentAddresses("mainnet-beta", "EBRNhGViU4PET5vyRpvTzgTCo3twsNEcbMRyiZCAWL7"),
    ).toHaveLength(4);
  });
});
