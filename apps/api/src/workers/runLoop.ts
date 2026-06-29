import type { ConfidentialIndexer } from "@confidential-indexer/core";
import { runOnce } from "./runOnce.js";

export function runLoop(indexer: ConfidentialIndexer, intervalMs: number): { stop: () => void } {
  let stopped = false;
  let timeout: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runOnce(indexer);
    } catch (error) {
      console.error("worker tick failed", error);
    } finally {
      if (!stopped) timeout = setTimeout(tick, intervalMs);
    }
  };

  timeout = setTimeout(tick, 0);

  return {
    stop() {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    },
  };
}
