const maxSafeEpochSeconds = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000));

export function toDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}

export function toExpirationDate(seconds: bigint): Date | null {
  if (seconds === 0n || seconds > maxSafeEpochSeconds) return null;
  return toDate(seconds);
}
