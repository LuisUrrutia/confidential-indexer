import { isNonZeroAddress, type Address } from "./addresses.js";
import type { StoredActivity } from "./activities.js";
import type { StoredTransfer } from "./transfers.js";

function uniqueCandidateAddresses(candidates: readonly (Address | null)[]): Address[] {
  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is Address => {
    if (!candidate || !isNonZeroAddress(candidate)) return false;
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function holderCandidatesForTransfer(
  transfer: StoredTransfer,
  activeDelegators: readonly Address[],
): Address[] {
  return uniqueCandidateAddresses([transfer.to, transfer.from, ...activeDelegators]);
}

export function holderCandidatesForActivity(
  activity: StoredActivity,
  activeDelegators: readonly Address[],
): Address[] {
  return uniqueCandidateAddresses([
    activity.receiver,
    activity.to,
    activity.from,
    ...activeDelegators,
  ]);
}
