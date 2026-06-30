export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export function isNonZeroAddress(address: Address): boolean {
  return address.toLowerCase() !== ZERO_ADDRESS;
}
