import Dexie, { type EntityTable } from "dexie";
import type { ContactFields, Flag, SkipReason } from "../core/types";

export type CardState = "queued" | "processing" | "looks_good" | "needs_review" | "skipped" | "approved" | "error";

export interface BatchRecord {
  id: string;
  eventName: string;
  createdAt: number;
}

export interface CardRecord {
  id: string;
  batchId: string;
  createdAt: number;
  image: Blob;
  state: CardState;
  provider?: string;
  model?: string;
  usageTokens?: number;
  fallbackUsed?: boolean;
  rateLimitedModels?: string[];
  completedAt?: number;
  fields?: ContactFields;
  flags?: Flag[];
  skipReason?: SkipReason;
  error?: string;
  qualityWarning?: string;
}

class ContactScanDatabase extends Dexie {
  batches!: EntityTable<BatchRecord, "id">;
  cards!: EntityTable<CardRecord, "id">;

  constructor() {
    super("aaj-contact-scan");
    this.version(1).stores({ batches: "id, createdAt", cards: "id, batchId, createdAt, state" });
  }
}

export const db = new ContactScanDatabase();
