import type { ConfidentialIndexer } from "@confidential-indexer/core";

export async function runIndexerWorkerCycle(indexer: ConfidentialIndexer): Promise<void> {
  await indexer.ingestNextBatch();
  await indexer.processPendingDecryptions(100);
}
