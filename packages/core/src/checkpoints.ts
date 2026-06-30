import type { EventCursor } from "./events.js";

export interface CheckpointRepository {
  getCursor(sourceName: string): Promise<EventCursor | null>;
  saveCursor(sourceName: string, cursor: EventCursor | null): Promise<void>;
}
