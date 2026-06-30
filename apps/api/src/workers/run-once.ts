import type { ConfidentialIndexer } from "@confidential-indexer/core";

export async function runOnce(indexer: ConfidentialIndexer): Promise<void> {
  await indexer.ingestNextBatch();
  await indexer.processPendingDecryptions(100);
}
