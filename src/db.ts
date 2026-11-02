import Dexie, { type EntityTable } from "dexie";
import { EVENT_NAME_LIMIT } from "./backup-validation";
import type { ContactFields, Flag, SkipReason } from "../core/types";

export type CardState = "queued" | "processing" | "looks_good" | "needs_review" | "skipped" | "approved" | "error";

export interface BatchRecord {
  id: string;
  eventName: string;
  eventDate?: string;
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
  approvedAt?: number;
  contactRevision?: number;
  backupState?: "pending" | "synced" | "failed";
  backupAttempts?: number;
  backupNextRetryAt?: number;
  backupUpdatedAt?: number;
  backupError?: string;
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
    // Add indexes only; historical approvals intentionally keep no backup state.
    this.version(2).stores({ batches: "id, createdAt", cards: "id, batchId, createdAt, state, backupState, backupNextRetryAt" });
    this.version(3).stores({ batches: "id, createdAt", cards: "id, batchId, createdAt, state, backupState, backupNextRetryAt" })
      .upgrade((transaction) => transaction.table("cards").toCollection().modify((card: CardRecord) => {
        if (card.state === "approved" && card.backupState && card.contactRevision === undefined) card.contactRevision = 1;
      }));
  }
}

export const db = new ContactScanDatabase();

function localEventDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function createBatchLocally(eventName: string, createdAt = Date.now()): Promise<BatchRecord> {
  const name = eventName.trim();
  if (!name || name.length > EVENT_NAME_LIMIT || name.includes("\0")) throw new Error("Use an event name of 1 to 200 characters.");
  const batch = { id: crypto.randomUUID(), eventName: name, createdAt, eventDate: localEventDate(createdAt) };
  await db.batches.add(batch);
  return batch;
}

export async function getBatchForBackup(id: string): Promise<BatchRecord | undefined> {
  return db.transaction("rw", db.batches, async () => {
    const batch = await db.batches.get(id);
    // Legacy batches have no original timezone. Freeze the creation timestamp's
    // local date in the first uploading browser, before sending any contact.
    if (batch && !batch.eventDate) {
      batch.eventDate = localEventDate(batch.createdAt);
      await db.batches.put(batch);
    }
    return batch;
  });
}
