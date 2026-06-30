import type { EventCursor, IndexedEventBatch } from "./events.js";

export interface IndexedEventSource {
  nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch>;
}
