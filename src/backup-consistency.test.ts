import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type CardRecord } from "./db";
import * as database from "./db";
import { createBackupCoordinator, retryBackup, saveCardLocally } from "./backup-sync";
import { backupContact } from "./api";
import { createCsvExport } from "./csv";
import { createWorker } from "../worker/index";

const source: CardRecord = { id: "contact", batchId: "event", createdAt: 1000, image: new Blob(), state: "needs_review",
  fields: { firstName: "Ada", lastName: null, company: "Original", email: null, jobTitle: null, phone: null } };
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.batches.add({ id: "event", eventName: "Synthetic", createdAt: 1793577600000 });
  await db.cards.add(source);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete(); });

describe("persisted backup consistency", () => {
  it("assigns approval revision one, increments concurrent corrections transactionally and keeps it on retry", async () => {
    await saveCardLocally(source, true, 2000);
    expect((await db.cards.get(source.id))?.contactRevision).toBe(1);
    const approved = (await db.cards.get(source.id))!;
    await Promise.all([saveCardLocally({ ...approved, fields: { ...approved.fields!, company: "Second" } }),
      saveCardLocally({ ...approved, fields: { ...approved.fields!, company: "Third" } })]);
    expect((await db.cards.get(source.id))?.contactRevision).toBe(3);
    await db.cards.update(source.id, { backupState: "failed" });
    await retryBackup(source.id);
    expect((await db.cards.get(source.id))?.contactRevision).toBe(3);
  });

  it("keeps corrected text synced locally and in the real server after an independent tab's old request arrives last", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(readFileSync(new URL("../migrations/backup/0001_backup_contacts.sql", import.meta.url), "utf8"));
    sqlite.exec(readFileSync(new URL("../migrations/backup/0002_contact_revision.sql", import.meta.url), "utf8"));
    const server = createWorker({ now: () => 5000 });
    const backupDb = { prepare(sql: string) { return { bind(...values: (number | string | null)[]) {
      const statement = sqlite.prepare(sql);
      return { async run() { statement.run(...values); }, async all() { return { results: statement.all(...values) }; } };
    } }; } };
    let release!: () => void; let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.fields.company === "Original") { started(); await waiting; }
      return server.fetch(new Request(`https://example.test${path}`, init), { TEAM_PASSCODE: "team", BACKUP_DB: backupDb } as never);
    });
    await saveCardLocally(source, true, 2000);
    const first = createBackupCoordinator("team", { isOnline: () => true }).run();
    await began;
    // A separate module instance represents a second browser tab: it has its own
    // pass queue and Dexie connection, while sharing persisted IndexedDB data.
    vi.resetModules();
    const secondTab = await import("./backup-sync");
    const secondDb = (await import("./db")).db;
    try {
      const original = (await db.cards.get(source.id))!;
      await secondTab.saveCardLocally({ ...original, fields: { ...original.fields!, company: "Corrected" } }, false, 3000);
      await secondTab.createBackupCoordinator("team", { isOnline: () => true }).run();
      release(); await first;
      expect(sqlite.prepare("SELECT company FROM backup_contacts").get()).toEqual({ company: "Corrected" });
      expect(await db.cards.get(source.id)).toMatchObject({ fields: { company: "Corrected" }, contactRevision: 2, backupState: "synced" });
    } finally { release(); await first; secondDb.close(); sqlite.close(); }
  });

  it("does not acknowledge a receipt for a different stored revision", async () => {
    await saveCardLocally(source, true, 2000);
    await createBackupCoordinator("team", { isOnline: () => true, now: () => 4000,
      upload: async () => ({ contactId: source.id, contactRevision: 0, backedUpAt: 3000 }) }).run();
    expect((await db.cards.get(source.id))?.backupState).toBe("failed");
  });

  it("captures the date at creation and freezes a legacy fallback before upload despite later date-context changes", async () => {
    const created = await database.createBatchLocally("New event", new Date(2026, 10, 2, 0, 15).getTime());
    expect(created.eventDate).toBe("2026-11-02");
    await saveCardLocally(source, true, 2000);
    const dates: string[] = [];
    vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); dates.push(body.eventDate);
      return Response.json({ contactId: source.id, contactRevision: body.contactRevision, backedUpAt: 5000 });
    });
    await createBackupCoordinator("team", { isOnline: () => true, upload: async (contact, batch, passcode) => {
      expect((await db.batches.get(batch.id))?.eventDate).toBe(batch.eventDate);
      return backupContact(contact, batch, passcode);
    } }).run();
    const frozen = (await db.batches.get("event"))!.eventDate;
    expect(frozen).toMatch(/^2026-11-0[12]$/);
    vi.spyOn(Date.prototype, "getDate").mockReturnValue(9);
    const approved = (await db.cards.get(source.id))!;
    await saveCardLocally({ ...approved, fields: { ...approved.fields!, company: "Corrected" } });
    await createBackupCoordinator("team", { isOnline: () => true }).run();
    expect(dates).toEqual([frozen, frozen]);
  });
});


it("keeps oversized extracted text approved and exportable while cloud backup explains the fix", async () => {
  const text = "a".repeat(301);
  await saveCardLocally({ ...source, fields: { ...source.fields!, company: text } }, true, 2000);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await createBackupCoordinator("team", { isOnline: () => true, now: () => 4000 }).run();
  const saved = (await db.cards.get(source.id))!;
  expect(saved).toMatchObject({ state: "approved", fields: { company: text }, backupState: "failed" });
  expect(saved.backupError).toContain("Shorten company to 300 characters");
  expect(createCsvExport((await db.batches.get("event"))!, [saved]).content).toContain(text);
  expect(fetch).not.toHaveBeenCalled();
});
