import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  normalizeBackupContact, upsertBackupContact, listBackupEvents, readBackupCsv,
  type BackupDatabase,
} from "./backup";

const now = 1_793_620_800_000;
const input = {
  contactId: "contact-01", contactRevision: 1, batchId: "batch-phone-a", eventName: "  AAJ   Expo  ", eventDate: "2026-11-02",
  fields: { firstName: "Ada", lastName: "Lovelace", company: "AAJ", email: "ada@example.test", jobTitle: null, phone: "+91 123" },
  provider: "gemini", model: "gemini-3.5-flash-lite", cardCreatedAt: now - 2_000, approvedAt: now - 1_000,
};
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database(applyRevision = true) {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec(readFileSync(new URL("../migrations/backup/0001_backup_contacts.sql", import.meta.url), "utf8"));
  if (applyRevision) sqlite.exec(readFileSync(new URL("../migrations/backup/0002_contact_revision.sql", import.meta.url), "utf8"));
  const queries: { sql: string; values: unknown[] }[] = [];
  const db: BackupDatabase = {
    prepare(sql) {
      return { bind(...values) {
        queries.push({ sql, values });
        const statement = sqlite.prepare(sql);
        return {
          async run() { statement.run(...values as (string | number | null)[]); return { success: true }; },
          async all<T>() { return { results: statement.all(...values as (string | number | null)[]) as T[] }; },
        };
      } };
    },
  };
  return { sqlite, db, queries };
}

describe("normalizeBackupContact", () => {
  it("keeps only approved text, preserving the source batch and phone-local event date", async () => {
    const contact = await normalizeBackupContact({ ...input, image: "private", imageBase64: "private", ocrText: "private", surprise: { nested: true }, fields: { ...input.fields, rawOcr: "private" } });
    expect(contact).toMatchObject({ contactId: "contact-01", batchId: "batch-phone-a", eventName: "AAJ Expo", eventDate: "2026-11-02", fields: input.fields });
    expect(JSON.stringify(contact)).not.toContain("private");
    expect(Object.keys(contact!).sort()).toEqual(["approvedAt", "batchId", "cardCreatedAt", "contactId", "contactRevision", "eventDate", "eventKey", "eventName", "fields", "model", "provider"]);
  });
  it("consolidates normalized names on the same date and separates other dates and names", async () => {
    const first = await normalizeBackupContact(input);
    const second = await normalizeBackupContact({ ...input, batchId: "batch-phone-b", eventName: "aaj expo" });
    expect(first?.eventKey).toMatch(/^[a-f0-9]{64}$/);
    expect(second?.eventKey).toBe(first?.eventKey);
    expect((await normalizeBackupContact({ ...input, eventDate: "2026-11-03" }))?.eventKey).not.toBe(first?.eventKey);
    expect((await normalizeBackupContact({ ...input, eventName: "AAJ Other Expo" }))?.eventKey).not.toBe(first?.eventKey);
  });
  it.each([
    null, [], ...[undefined, 0, -1, 1.5, "1", Infinity, 9007199254740992].map((contactRevision) => ({ ...input, contactRevision })), { ...input, contactId: "bad id" }, { ...input, batchId: "" },
    { ...input, eventName: " " }, { ...input, eventName: "a".repeat(201) },
    { ...input, eventDate: "2026-02-30" }, { ...input, eventDate: "2026-11-02T00:00:00Z" },
    { ...input, eventDate: "2026-1-2" }, { ...input, eventDate: "2025-02-29" },
    { ...input, cardCreatedAt: -1 }, { ...input, approvedAt: now - 3_000 },
    { ...input, approvedAt: Infinity }, { ...input, cardCreatedAt: 1.2 },
    { ...input, fields: { ...input.fields, firstName: {} } },
    { ...input, fields: { ...input.fields, firstName: "a".repeat(201) } },
    { ...input, fields: { ...input.fields, lastName: "a".repeat(201) } },
    { ...input, fields: { ...input.fields, company: "a".repeat(301) } },
    { ...input, fields: { ...input.fields, email: "a".repeat(321) } },
    { ...input, fields: { ...input.fields, jobTitle: "a".repeat(301) } },
    { ...input, fields: { ...input.fields, phone: "a".repeat(101) } },
    { ...input, provider: "a".repeat(65) }, { ...input, model: "a".repeat(201) },
    { ...input, fields: null },
  ])("rejects malformed, nontext or oversized approved fields %#", async (value) => {
    expect(await normalizeBackupContact(value)).toBeNull();
  });
  it("accepts a valid leap date and nullable contact/provider metadata", async () => {
    expect(await normalizeBackupContact({ ...input, eventDate: "2028-02-29", fields: { firstName: null, lastName: null, company: null, email: null, jobTitle: null, phone: null }, provider: null, model: null })).not.toBeNull();
  });
});

describe("D1 contact backup", () => {
  it("upgrades already-applied version-one rows to revision zero without data loss", async () => {
    const { db, sqlite } = database(false);
    sqlite.prepare(`INSERT INTO backup_contacts (contact_id, batch_id, event_key, event_name, event_date, company, card_created_at, approved_at, backed_up_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("contact-01", "batch-phone-a", "a".repeat(64), "AAJ Expo", "2026-11-02", "Legacy", now - 2000, now - 1000, now);
    sqlite.exec(readFileSync(new URL("../migrations/backup/0002_contact_revision.sql", import.meta.url), "utf8"));
    expect(sqlite.prepare("SELECT company, contact_revision FROM backup_contacts").get()).toEqual({ company: "Legacy", contact_revision: 0 });
    expect(await upsertBackupContact(db, input, now + 1)).toMatchObject({ contactRevision: 1 });
    expect(() => sqlite.prepare("UPDATE backup_contacts SET contact_revision = -1").run()).toThrow();
  });

  it("retains the newest revision when older uploads arrive afterward and retries are idempotent", async () => {
    const { db, sqlite } = database();
    const corrected = { ...input, contactRevision: 2, fields: { ...input.fields, company: "Corrected" } };
    expect(await upsertBackupContact(db, corrected, now)).toMatchObject({ contactRevision: 2, backedUpAt: now });
    expect(await upsertBackupContact(db, { ...input, contactRevision: 1 }, now + 1)).toMatchObject({ contactRevision: 2, backedUpAt: now });
    expect(await upsertBackupContact(db, corrected, now + 2)).toMatchObject({ contactRevision: 2, backedUpAt: now });
    expect(sqlite.prepare("SELECT company FROM backup_contacts").get()).toEqual({ company: "Corrected" });
  });

  it("parameterizes approved text and upserts corrections without duplicating the contact", async () => {
    const { db, sqlite, queries } = database();
    expect(await upsertBackupContact(db, { ...input, imageBase64: "never bind this", fields: { ...input.fields, rawOcr: "never bind this" } }, now)).toEqual({ contactId: "contact-01", contactRevision: 1, backedUpAt: now });
    await upsertBackupContact(db, { ...input, contactRevision: 2, fields: { ...input.fields, company: "O'Brian, Inc." } }, now + 1);
    expect(queries[0]?.sql).toMatch(/ON CONFLICT\s*\(contact_id\) DO UPDATE/i);
    expect(queries[2]?.sql).not.toContain("O'Brian");
    expect(JSON.stringify(queries)).not.toContain("never bind this");
    expect(sqlite.prepare("SELECT contact_id, company, batch_id, backed_up_at FROM backup_contacts").all()).toEqual([{ contact_id: "contact-01", company: "O'Brian, Inc.", batch_id: "batch-phone-a", backed_up_at: now + 1 }]);
    await expect(upsertBackupContact(db, { ...input, batchId: "bad id" }, now)).rejects.toThrow();
    expect(queries).toHaveLength(4);
  });
  it("aggregates two source batches into one event without exposing individual contact fields", async () => {
    const { db } = database();
    const saved = await normalizeBackupContact(input);
    await upsertBackupContact(db, input, now);
    await upsertBackupContact(db, { ...input, contactId: "contact-02", batchId: "batch-phone-b", eventName: "AAJ Expo" }, now + 100);
    expect(await listBackupEvents(db)).toEqual({ events: [{ eventKey: saved!.eventKey, eventName: "AAJ Expo", eventDate: "2026-11-02", contactCount: 2, lastBackupAt: now + 100 }], nextCursor: null });
  });
  it("bounds event pages and uses a stable cursor without duplicates or omissions", async () => {
    const { db, queries } = database();
    await upsertBackupContact(db, input, now);
    await upsertBackupContact(db, { ...input, contactId: "contact-02", eventName: "Second" }, now);
    const first = await listBackupEvents(db, { limit: 1 });
    const second = await listBackupEvents(db, { limit: 1, cursor: first.nextCursor! });
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(first.events[0]?.eventKey).not.toBe(second.events[0]?.eventKey);
    expect(second.nextCursor).toBeNull();
    await listBackupEvents(db, { limit: 1_000_000 });
    expect(queries.at(-1)?.values.at(-1)).toBe(101);
    await expect(listBackupEvents(db, { cursor: "' SQL injection" })).rejects.toThrow();
    await expect(listBackupEvents(db, { limit: -1 })).rejects.toThrow();
  });
  it("exports all event batches in explicit card/id order with exact HubSpot CSV escaping", async () => {
    const { db, queries } = database();
    const key = (await normalizeBackupContact(input))!.eventKey;
    await upsertBackupContact(db, { ...input, contactId: "z", fields: { firstName: "=1+1", lastName: "+A", company: "-A", email: "@A", jobTitle: "\tA", phone: "\rA" } }, now);
    await upsertBackupContact(db, { ...input, contactId: "a", batchId: "batch-phone-b", fields: { ...input.fields, company: 'A, "B"' } }, now);
    await upsertBackupContact(db, { ...input, contactId: "other-event", eventDate: "2026-11-03" }, now);
    const csv = await readBackupCsv(db, key);
    expect(csv?.content).toBe('"First Name","Last Name","Company Name","Email","Job Title","Phone Number","Event Name"\r\n"Ada","Lovelace","A, ""B""","ada@example.test","","\'+91 123","AAJ Expo"\r\n"\'=1+1","\'+A","\'-A","\'@A","\'\tA","\'\rA","AAJ Expo"');
    expect(queries.at(-1)?.sql).toMatch(/ORDER BY card_created_at ASC, contact_id ASC/i);
    expect(queries.at(-1)?.values).toEqual([key]);
    expect(await readBackupCsv(db, "a".repeat(64))).toBeNull();
    await expect(readBackupCsv(db, "../bad")).rejects.toThrow();
  });
  it("sanitizes filenames and neutralizes formula-like event names", async () => {
    const { db } = database();
    const hostile = { ...input, eventName: '=Evil/"\r\nName' };
    await upsertBackupContact(db, hostile, now);
    const csv = await readBackupCsv(db, (await normalizeBackupContact(hostile))!.eventKey);
    expect(csv?.filename).toBe("evil-name.csv");
    expect(csv?.content).toContain('"\'=Evil/"" Name"');
  });
  it("enforces bounds at the database boundary as well as the Worker", async () => {
    const { db, sqlite } = database();
    await upsertBackupContact(db, input, now);
    expect(() => sqlite.prepare("UPDATE backup_contacts SET email = ?").run("a".repeat(321))).toThrow();
    expect(() => sqlite.prepare("UPDATE backup_contacts SET event_name = ''").run()).toThrow();
    expect(() => sqlite.prepare("UPDATE backup_contacts SET approved_at = -1").run()).toThrow();
    expect(sqlite.prepare("PRAGMA table_info(backup_contacts)").all().map((row) => row.name)).not.toEqual(expect.arrayContaining(["image", "ocr_text", "passcode", "api_key"]));
  });
});
