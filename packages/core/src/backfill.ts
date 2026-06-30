import type { Address } from "./addresses.js";
import type { DecryptionReport } from "./decryption.js";

export interface BackfillHolderInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
}

export interface BackfillReport {
  holder: Address;
  transferReport: DecryptionReport;
  balanceRefreshed: boolean;
}
