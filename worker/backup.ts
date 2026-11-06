// Text-only backup boundary. Do not import browser/IndexedDB or extraction payloads.
import { contactsCsv, csvFilename } from "../core/csv";

interface BackupFields {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  jobTitle: string | null;
  phone: string | null;
}
export interface BackupContact {
  contactId: string;
  contactRevision: number;
  batchId: string;
  eventKey: string;
  eventName: string;
  eventDate: string;
  fields: BackupFields;
  provider: string | null;
  model: string | null;
  cardCreatedAt: number;
  approvedAt: number;
}
export interface BackupDatabase {
  prepare(query: string): {
    bind(...values: (string | number | null)[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}
export interface BackupEvent {
  eventKey: string;
  eventName: string;
  eventDate: string;
  contactCount: number;
  lastBackupAt: number;
}
export class BackupValidationError extends Error {
  constructor() { super("Invalid backup request"); }
}
const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT_KEY = /^[a-f0-9]{64}$/;
const FIELD_LIMITS = { firstName: 200, lastName: 200, company: 300, email: 320, jobTitle: 300, phone: 100 } as const;
const isRecord = (input: unknown): input is Record<string, unknown> => !!input && typeof input === "object" && !Array.isArray(input);
const isText = (input: unknown, max: number): input is string | null => input === null || (typeof input === "string" && input.length <= max && !input.includes("\0"));
const isTimestamp = (input: unknown): input is number => typeof input === "number" && Number.isSafeInteger(input) && input > 0 && input <= 8_640_000_000_000_000;

export async function normalizeBackupContact(input: unknown): Promise<BackupContact | null> {
  if (!isRecord(input) || !isRecord(input.fields)) return null;
  if (!Number.isSafeInteger(input.contactRevision) || (input.contactRevision as number) < 1
    || typeof input.contactId !== "string" || !IDENTIFIER.test(input.contactId)
    || typeof input.batchId !== "string" || !IDENTIFIER.test(input.batchId)
    || typeof input.eventName !== "string" || input.eventName.length > 200 || input.eventName.includes("\0")
    || typeof input.eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)
    || !isTimestamp(input.cardCreatedAt) || !isTimestamp(input.approvedAt) || input.approvedAt < input.cardCreatedAt
    || !isText(input.provider, 64) || !isText(input.model, 200)) return null;
  // Validate the supplied calendar date, never infer it from UTC or Worker time.
  const calendar = new Date(`${input.eventDate}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== input.eventDate) return null;
  const eventName = input.eventName.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!eventName || eventName.length > 200) return null;
  const fields = {} as BackupFields;
  for (const key of Object.keys(FIELD_LIMITS) as (keyof BackupFields)[]) {
    const value = input.fields[key];
    if (!isText(value, FIELD_LIMITS[key])) return null;
    fields[key] = value;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${eventName.toLowerCase()}\n${input.eventDate}`));
  const eventKey = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  // Explicit allowlist: images, OCR, unknown metadata and nested properties cannot
  // reach SQL bindings, even when an older client includes them in its payload.
  return { contactId: input.contactId, contactRevision: input.contactRevision as number, batchId: input.batchId, eventKey, eventName, eventDate: input.eventDate,
    fields, provider: input.provider, model: input.model, cardCreatedAt: input.cardCreatedAt, approvedAt: input.approvedAt };
}

const UPSERT = `INSERT INTO backup_contacts
  (contact_id, batch_id, event_key, event_name, event_date, first_name, last_name, company, email, job_title, phone, provider, model, card_created_at, approved_at, backed_up_at, contact_revision)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(contact_id) DO UPDATE SET
    batch_id = excluded.batch_id, event_key = excluded.event_key, event_name = excluded.event_name, event_date = excluded.event_date,
    first_name = excluded.first_name, last_name = excluded.last_name, company = excluded.company, email = excluded.email,
    job_title = excluded.job_title, phone = excluded.phone, provider = excluded.provider, model = excluded.model,
    card_created_at = excluded.card_created_at, approved_at = excluded.approved_at, backed_up_at = excluded.backed_up_at,
    contact_revision = excluded.contact_revision
  WHERE excluded.contact_revision > backup_contacts.contact_revision`;

export async function upsertBackupContact(db: BackupDatabase, input: unknown, now = Date.now()) {
  const contact = await normalizeBackupContact(input);
  if (!contact || !isTimestamp(now)) throw new BackupValidationError();
  const { fields: f } = contact;
  await db.prepare(UPSERT).bind(contact.contactId, contact.batchId, contact.eventKey, contact.eventName, contact.eventDate,
    f.firstName, f.lastName, f.company, f.email, f.jobTitle, f.phone, contact.provider, contact.model,
    contact.cardCreatedAt, contact.approvedAt, now, contact.contactRevision).run();
  // Read the stored receipt even when a stale request or idempotent retry did not
  // update anything. A client can only acknowledge the revision actually stored.
  const { results } = await db.prepare(`SELECT contact_id AS contactId, contact_revision AS contactRevision,
    backed_up_at AS backedUpAt FROM backup_contacts WHERE contact_id = ?`).bind(contact.contactId)
    .all<{ contactId: string; contactRevision: number; backedUpAt: number }>();
  if (!results[0]) throw new Error("Backup receipt unavailable");
  return results[0];
}

export async function listBackupEvents(db: BackupDatabase, options: { limit?: number; cursor?: string } = {}) {
  const requested = options.limit ?? 50;
  if (!Number.isSafeInteger(requested) || requested < 1 || (options.cursor !== undefined && !EVENT_KEY.test(options.cursor))) throw new BackupValidationError();
  const limit = Math.min(requested, 100);
  const { results } = await db.prepare(`SELECT event_key AS eventKey, MIN(event_name) AS eventName, MIN(event_date) AS eventDate,
    COUNT(*) AS contactCount, MAX(backed_up_at) AS lastBackupAt
    FROM backup_contacts WHERE event_key > ? GROUP BY event_key ORDER BY event_key ASC LIMIT ?`)
    .bind(options.cursor ?? "", limit + 1).all<BackupEvent>();
  const events = results.slice(0, limit);
  return { events, nextCursor: results.length > limit ? events.at(-1)!.eventKey : null };
}

export async function readBackupCsv(db: BackupDatabase, eventKey: string) {
  if (!EVENT_KEY.test(eventKey)) throw new BackupValidationError();
  const { results } = await db.prepare(`SELECT first_name AS firstName, last_name AS lastName, company, email,
    job_title AS jobTitle, phone, event_name AS eventName FROM backup_contacts
    WHERE event_key = ? ORDER BY card_created_at ASC, contact_id ASC`).bind(eventKey).all<BackupFields & { eventName: string }>();
  if (!results.length) return null;
  return { content: contactsCsv(results), filename: csvFilename(results[0]!.eventName) };
}
