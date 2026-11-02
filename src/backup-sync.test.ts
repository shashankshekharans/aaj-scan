import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type BatchRecord, type CardRecord } from "./db";
import { createBackupCoordinator, nextBackupRetry, retryBackup, saveCardLocally, selectBackupCandidates, startBackupSync } from "./backup-sync";

const batch: BatchRecord = { id: "event", eventName: "Synthetic fair", createdAt: 1000 };
const card = (id: string, changes: Partial<CardRecord> = {}): CardRecord => ({
  id, batchId: "event", createdAt: 1000, image: new Blob(["private image"]), state: "approved",
  approvedAt: 2000, contactRevision: 1, backupState: "pending", backupUpdatedAt: 2000,
  fields: { firstName: "Ada", lastName: null, company: "Synthetic", email: "ada@example.com", jobTitle: null, phone: null },
  ...changes,
});

beforeEach(async () => { await db.delete(); await db.open(); await db.batches.add(batch); });
afterEach(async () => { vi.useRealTimers(); await db.delete(); });

describe("backup policy", () => {
  it("selects only due approved pending/failed cards, leaving historical approvals private", () => {
    const cards = [card("pending"), card("due", { backupState: "failed", backupNextRetryAt: 3000 }),
      card("later", { backupState: "failed", backupNextRetryAt: 3001 }), card("historical", { backupState: undefined }),
      card("synced", { backupState: "synced" }), card("review", { state: "needs_review" }), card("queued", { state: "queued" })];
    expect(selectBackupCandidates(cards, 3000, 10).map((item) => item.id)).toEqual(["due", "pending"]);
  });

  it("uses creation order with a stable ID tie-break and bounded limit", () => {
    expect(selectBackupCandidates([card("z"), card("b", { createdAt: 500 }), card("a", { createdAt: 500 })], 3000, 2).map((item) => item.id)).toEqual(["a", "b"]);
    expect(selectBackupCandidates([card("a")], 3000, 0)).toEqual([]);
  });

  it("backs off exponentially and stays capped after many failures", () => {
    expect([1, 2, 3, 10, 1000].map((attempts) => nextBackupRetry(attempts, 1000))).toEqual([31000, 61000, 121000, 1801000, 1801000]);
  });
});

describe("local approval and migration", () => {
  it("upgrades enrolled version-two cards to revision one while leaving historical cards un-enrolled", async () => {
    await db.delete();
    const old = new Dexie("aaj-contact-scan");
    old.version(2).stores({ batches: "id, createdAt", cards: "id, batchId, createdAt, state, backupState, backupNextRetryAt" });
    await old.table("batches").add(batch);
    await old.table("cards").bulkAdd([card("enrolled", { contactRevision: undefined }), card("historical", { contactRevision: undefined, backupState: undefined })]);
    old.close(); await db.open();
    expect(await db.cards.get("enrolled")).toMatchObject({ contactRevision: 1, backupState: "pending" });
    const historical = (await db.cards.get("historical"))!;
    expect(historical.contactRevision).toBeUndefined();
    expect(historical.backupState).toBeUndefined();
    expect((await db.batches.get("event"))?.eventDate).toBeUndefined();
  });

  it("opens version 1 data without deleting cards, batches or auto-enrolling historical approvals", async () => {
    await db.delete();
    const old = new Dexie("aaj-contact-scan");
    old.version(1).stores({ batches: "id, createdAt", cards: "id, batchId, createdAt, state" });
    const historical = card("old", { backupState: undefined, approvedAt: undefined, contactRevision: undefined, backupUpdatedAt: undefined });
    await old.table("batches").add(batch);
    await old.table("cards").add(historical);
    old.close();
    await db.open();
    expect(db.verno).toBe(3);
    expect(await db.batches.get("event")).toEqual(batch);
    expect((await db.cards.get("old"))?.fields).toEqual(historical.fields);
    expect((await db.cards.get("old"))?.backupState).toBeUndefined();
    expect((await db.cards.get("old"))?.contactRevision).toBeUndefined();
    expect(await db.cards.where("backupState").equals("pending").count()).toBe(0);
  });

  it("commits a new approval locally with pending backup and an approval timestamp", async () => {
    const source = card("new", { state: "needs_review", approvedAt: undefined, backupState: undefined });
    await db.cards.add(source);
    await saveCardLocally(source, true, 5000);
    expect(await db.cards.get("new")).toMatchObject({ state: "approved", fields: source.fields, approvedAt: 5000, backupState: "pending", backupAttempts: 0, backupUpdatedAt: 5000 });
  });

  it("requeues an edited approval, preserving approval time and increasing revision even in one millisecond", async () => {
    const source = card("edit", { backupState: "synced", backupAttempts: 3, backupNextRetryAt: 9999, backupUpdatedAt: 5000, backupError: "old" });
    await db.cards.add(source);
    await saveCardLocally({ ...source, fields: { ...source.fields!, company: "Corrected" } }, false, 5000);
    const saved = await db.cards.get("edit");
    expect(saved).toMatchObject({ state: "approved", approvedAt: 2000, backupState: "pending", backupAttempts: 0, backupUpdatedAt: 5001, fields: { company: "Corrected" } });
    expect(saved?.backupNextRetryAt).toBeUndefined();
    expect(saved?.backupError).toBeUndefined();
  });

  it("does not enqueue an unapproved save", async () => {
    const source = card("review", { state: "needs_review", backupState: undefined });
    await db.cards.add(source);
    await saveCardLocally(source, false, 5000);
    expect((await db.cards.get("review"))?.backupState).toBeUndefined();
  });

  it("explicit retry resets failed backup timing without changing approved text", async () => {
    const source = card("failed", { backupState: "failed", backupAttempts: 5, backupNextRetryAt: 999999, backupError: "safe" });
    await db.cards.add(source);
    await retryBackup(source.id, 5000);
    expect(await db.cards.get(source.id)).toMatchObject({ state: "approved", fields: source.fields, backupState: "pending", backupAttempts: 0, backupUpdatedAt: 5000 });
    expect((await db.cards.get(source.id))?.backupNextRetryAt).toBeUndefined();
    await db.cards.add(card("historical", { backupState: undefined }));
    await retryBackup("historical", 5000);
    expect((await db.cards.get("historical"))?.backupState).toBeUndefined();
  });
});

const success = async (contact: CardRecord) => ({ contactId: contact.id, contactRevision: contact.contactRevision!, backedUpAt: 6000 });

describe("backup coordinator", () => {
  it("pauses offline without sending or consuming attempts", async () => {
    await db.cards.add(card("a"));
    const upload = vi.fn(success);
    await createBackupCoordinator("team", { upload, isOnline: () => false, now: () => 5000 }).run();
    expect(upload).not.toHaveBeenCalled();
    expect(await db.cards.get("a")).toMatchObject({ backupState: "pending", state: "approved" });
    expect((await db.cards.get("a"))?.backupAttempts).toBeUndefined();
  });

  it("uploads sequentially across all batches and updates only backup metadata", async () => {
    await db.batches.add({ ...batch, id: "other" });
    await db.cards.bulkAdd([card("a"), card("b", { batchId: "other" }), card("old", { backupState: undefined })]);
    let active = 0;
    let peak = 0;
    const sent: string[] = [];
    const coordinator = createBackupCoordinator("team", { isOnline: () => true, now: () => 5000,
      upload: async (contact, event, passcode) => {
        expect(passcode).toBe("team");
        expect(event.id).toBe(contact.batchId);
        active++; peak = Math.max(peak, active); sent.push(contact.id);
        await new Promise((resolve) => setTimeout(resolve, 1)); active--;
        return success(contact);
      },
    });
    await Promise.all([coordinator.run(), coordinator.run()]);
    expect(peak).toBe(1);
    expect(sent).toEqual(["a", "b"]);
    const saved = await db.cards.get("a");
    expect(saved).toMatchObject({ state: "approved", fields: card("a").fields, approvedAt: 2000, backupState: "synced", backupAttempts: 0, backupUpdatedAt: 6000 });
    expect(await saved!.image.text()).toBe("private image");
    expect((await db.cards.get("old"))?.backupState).toBeUndefined();
  });

  it("remembers an approval wake-up arriving during another upload without overlapping requests", async () => {
    await db.cards.add(card("a"));
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = createBackupCoordinator("team", { now: () => 5000, isOnline: () => true, upload: async (contact) => {
      if (contact.id === "a") { started(); await waiting; }
      return success(contact);
    } });
    const first = coordinator.run();
    await began;
    await db.cards.add(card("b"));
    const second = coordinator.run();
    release();
    await Promise.all([first, second]);
    expect((await db.cards.get("b"))?.backupState).toBe("synced");
  });
  it("limits each pass while leaving the rest pending for the next pass", async () => {
    await db.cards.bulkAdd(Array.from({ length: 12 }, (_, i) => card(String(i).padStart(2, "0"))));
    const coordinator = createBackupCoordinator("team", { upload: success, isOnline: () => true, now: () => 5000 });
    await coordinator.run();
    expect(await db.cards.where("backupState").equals("synced").count()).toBe(10);
    await coordinator.run();
    expect(await db.cards.where("backupState").equals("synced").count()).toBe(12);
  });

  it("keeps approvals after a safe failure and does not retry until backoff expires", async () => {
    await db.cards.add(card("a"));
    let now = 5000;
    const coordinator = createBackupCoordinator("team", { isOnline: () => true, now: () => now,
      upload: async () => { throw new Error("SQL private email ada@example.com"); },
    });
    await coordinator.run();
    expect(await db.cards.get("a")).toMatchObject({ state: "approved", backupState: "failed", backupAttempts: 1, backupNextRetryAt: 35000, backupError: "Could not back up this contact. Please try again." });
    await coordinator.run();
    expect((await db.cards.get("a"))?.backupAttempts).toBe(1);
    now = 35000;
    await coordinator.run();
    expect(await db.cards.get("a")).toMatchObject({ backupAttempts: 2, backupNextRetryAt: 95000 });
  });

  it("leaves an interrupted offline upload pending and stops before the next contact", async () => {
    await db.cards.bulkAdd([card("a"), card("b")]);
    let online = true;
    await createBackupCoordinator("team", { now: () => 5000, isOnline: () => online, upload: async () => { online = false; throw new TypeError("offline"); } }).run();
    expect(await db.cards.where("backupState").equals("pending").count()).toBe(2);
    expect((await db.cards.get("a"))?.backupAttempts).toBeUndefined();
  });

  it("does not mark a correction synced using the earlier upload response", async () => {
    await db.cards.add(card("a"));
    await createBackupCoordinator("team", { now: () => 5000, isOnline: () => true, upload: async (contact) => {
      await saveCardLocally({ ...contact, fields: { ...contact.fields!, company: "Corrected while uploading" } }, false, 5500);
      return success(contact);
    } }).run();
    expect(await db.cards.get("a")).toMatchObject({ backupState: "pending", backupUpdatedAt: 5500, fields: { company: "Corrected while uploading" } });
  });

  it("does not recreate a contact deleted during upload", async () => {
    await db.cards.add(card("a"));
    await createBackupCoordinator("team", { now: () => 5000, isOnline: () => true, upload: async (contact) => {
      await db.cards.delete(contact.id); return success(contact);
    } }).run();
    expect(await db.cards.get("a")).toBeUndefined();
  });

  it("handles a missing batch as a bounded safe failure", async () => {
    await db.cards.add(card("a", { batchId: "missing" }));
    await createBackupCoordinator("team", { now: () => 5000, isOnline: () => true, upload: success }).run();
    expect(await db.cards.get("a")).toMatchObject({ state: "approved", backupState: "failed", backupAttempts: 1, backupNextRetryAt: 35000 });
  });
});

describe("backup lifecycle", () => {
  it("serializes uploads across lock and unlock after a correction", async () => {
    await db.cards.add(card("a", { fields: { ...card("a").fields!, company: "Original" } }));
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const writes: string[] = [];
    let active = 0;
    let peak = 0;
    const upload = vi.fn(async (contact: CardRecord) => {
      active++; peak = Math.max(peak, active);
      if (contact.fields!.company === "Original") { started(); await waiting; }
      writes.push(contact.fields!.company!);
      active--;
      return success(contact);
    });
    const options = { upload, now: () => 5000, isOnline: () => true, events: new EventTarget(), schedule: () => () => {} };
    const first = startBackupSync("team", options);
    await began;
    first.stop();
    const original = (await db.cards.get("a"))!;
    await saveCardLocally({ ...original, fields: { ...original.fields!, company: "Corrected" } }, false, 5500);
    const replacement = startBackupSync("team", options);
    const completion = replacement.run();
    await new Promise((resolve) => setTimeout(resolve, 50));
    try { expect(upload).toHaveBeenCalledTimes(1); } finally { release(); }
    await completion;
    replacement.stop();
    expect(peak).toBe(1);
    expect(writes).toEqual(["Original", "Corrected"]);
    expect(await db.cards.get("a")).toMatchObject({ backupState: "synced", fields: { company: "Corrected" } });
  });

  it("starts on unlock/app restore, resumes online, polls due retries, and stops cleanly", async () => {
    // Only timer/browser boundaries are substituted; approval and coordinator use real IndexedDB.
    const events = new EventTarget();
    let tick: (() => void) | undefined;
    let cleared = false;
    let online = false;
    await db.cards.add(card("a"));
    const service = startBackupSync("team", { upload: success, now: () => 5000, isOnline: () => online, events,
      schedule: (callback) => { tick = callback; return () => { cleared = true; }; },
    });
    await service.run();
    expect((await db.cards.get("a"))?.backupState).toBe("pending");
    online = true;
    events.dispatchEvent(new Event("online"));
    await service.run();
    expect((await db.cards.get("a"))?.backupState).toBe("synced");
    await db.cards.add(card("b"));
    tick!();
    await service.run();
    expect((await db.cards.get("b"))?.backupState).toBe("synced");
    service.stop();
    expect(cleared).toBe(true);
    await db.cards.add(card("c"));
    events.dispatchEvent(new Event("online"));
    await service.run();
    expect((await db.cards.get("c"))?.backupState).toBe("pending");
  });
});
