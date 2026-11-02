import { afterEach, describe, expect, it, vi } from "vitest";
import { backupContact } from "./api";
import * as api from "./api";
import type { BatchRecord, CardRecord } from "./db";
import { normalizeBackupContact } from "../worker/backup";

const batch: BatchRecord = { id: "event", eventName: "Synthetic fair", eventDate: "2026-11-02", createdAt: new Date(2026, 10, 2, 0, 15).getTime() };
const card: CardRecord = { id: "card", batchId: "event", createdAt: batch.createdAt + 1000, approvedAt: batch.createdAt + 2000,
  state: "approved", contactRevision: 1, image: new Blob(["private photograph"]), backupState: "pending",
  fields: { firstName: "Ada", lastName: null, company: "Synthetic", email: "ada@example.com", jobTitle: null, phone: null },
  flags: [{ code: "missing", severity: "info", message: "private OCR" }], error: "private extraction error",
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const response = () => new Response(JSON.stringify({ contactId: "card", contactRevision: 1, backedUpAt: batch.createdAt + 3000 }), { status: 200 });

describe("backupContact", () => {
  it("uses the stored calendar date even when the upload date context differs", async () => {
    let sent: any;
    vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return response(); });
    await backupContact({ ...card, contactRevision: 1 }, { ...batch, eventDate: "2026-11-01" }, "team");
    expect(sent.eventDate).toBe("2026-11-01");
    expect(sent.contactRevision).toBe(1);
  });

  it.each([["firstName", 200, "first name"], ["lastName", 200, "last name"], ["company", 300, "company"], ["jobTitle", 300, "job title"], ["email", 320, "email"], ["phone", 100, "phone"]] as const)
  ("refuses oversized %s before upload with an actionable safe error", async (field, limit, label) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(backupContact({ ...card, contactRevision: 1, fields: { ...card.fields!, [field]: "a".repeat(limit + 1) } },
      { ...batch, eventDate: "2026-11-02" }, "team")).rejects.toThrow(`Shorten ${label} to ${limit} characters`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an oversized legacy event without sending or truncating it", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(backupContact({ ...card, contactRevision: 1 }, { ...batch, eventName: "a".repeat(201), eventDate: "2026-11-02" }, "team"))
      .rejects.toThrow("Shorten event name to 200 characters");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only approved contact text and phone-local event date in the Worker contract", async () => {
    let sent: unknown;
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      expect(path).toBe("/api/backup/contacts");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ "x-team-passcode": "team", "content-type": "application/json" });
      sent = JSON.parse(String(init.body));
      return response();
    });
    expect(await backupContact(card, batch, "team")).toEqual({ contactId: "card", contactRevision: 1, backedUpAt: batch.createdAt + 3000 });
    expect(sent).toEqual({ contactId: "card", contactRevision: 1, batchId: "event", eventName: "Synthetic fair", eventDate: "2026-11-02",
      fields: { firstName: "Ada", lastName: null, company: "Synthetic", email: "ada@example.com", jobTitle: null, phone: null },
      provider: null, model: null, cardCreatedAt: batch.createdAt + 1000, approvedAt: batch.createdAt + 2000 });
    expect(await normalizeBackupContact(sent)).not.toBeNull();
  });

  it("maps absent field/provider/model values to explicit null, including older partial records", async () => {
    let sent: unknown;
    vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return response(); });
    await backupContact({ ...card, fields: undefined, provider: undefined, model: undefined }, batch, "team");
    expect(sent).toMatchObject({ fields: { firstName: null, lastName: null, company: null, email: null, jobTitle: null, phone: null }, provider: null, model: null });
    expect(await normalizeBackupContact(sent)).not.toBeNull();
  });

  it("preserves optional provider/model text", async () => {
    let sent: unknown;
    vi.stubGlobal("fetch", async (_path: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return response(); });
    await backupContact({ ...card, provider: "gemini", model: "synthetic-model" }, batch, "team");
    expect(sent).toMatchObject({ provider: "gemini", model: "synthetic-model" });
  });

  it("does not send unapproved records", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(backupContact({ ...card, state: "needs_review" }, batch, "team")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([new Response(JSON.stringify({ error: "SQL private contact" }), { status: 500 }), new Response("not JSON", { status: 503 }),
    new Response(JSON.stringify({ contactId: "different", backedUpAt: 5000 })), new Response(JSON.stringify({ contactId: "card" }))])("returns a safe error for failed or malformed responses", async (result) => {
    vi.stubGlobal("fetch", async () => result);
    await expect(backupContact(card, batch, "team")).rejects.toThrow("Could not back up this contact. Please try again.");
  });

  it("bounds an upload that never responds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = expect(backupContact(card, batch, "team")).rejects.toThrow("Could not back up this contact. Please try again.");
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});


const backupEvent = { eventKey: "a".repeat(64), eventName: "Synthetic fair", eventDate: "2026-11-02", contactCount: 2, lastBackupAt: 1793577600000 };

describe("administrator recovery", () => {
  it("uses only the admin header and parses metadata without retaining contact fields", async () => {
    let sent: RequestInit | undefined;
    let path: unknown;
    vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
      path = url; sent = init;
      return Response.json({ events: [{ ...backupEvent, email: "private@example.com" }], nextCursor: "b".repeat(64) });
    });
    expect(await api.getBackupEvents("admin", "c".repeat(64))).toEqual({ events: [backupEvent], nextCursor: "b".repeat(64) });
    expect(path).toBe(`/api/admin/backups?cursor=${"c".repeat(64)}`);
    expect(new Headers(sent?.headers).get("x-admin-passcode")).toBe("admin");
    expect(new Headers(sent?.headers).has("x-team-passcode")).toBe(false);
    expect(sent?.cache).toBe("no-store");
  });

  it.each([
    { events: [{ ...backupEvent, contactCount: "2" }], nextCursor: null },
    { events: [{ ...backupEvent, eventKey: "bad" }], nextCursor: null },
    { events: [{ ...backupEvent, eventDate: "bad" }], nextCursor: null },
    { events: [{ ...backupEvent, eventDate: "2026-02-30" }], nextCursor: null },
    { events: [{ ...backupEvent, lastBackupAt: 9000000000000000 }], nextCursor: null },
    { events: [backupEvent], nextCursor: 4 },
    { events: [backupEvent] },
  ])("rejects malformed event metadata safely", async (body) => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(api.getBackupEvents("admin")).rejects.toThrow("Cloud backups are temporarily unavailable. Please try again.");
  });

  it.each([null, 'attachment; filename="../../private.csv"', 'attachment; filename="report.html"'])
  ("downloads authenticated CSV with a safe filename fallback for %s", async (disposition) => {
    let sent: RequestInit | undefined;
    let path: unknown;
    vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
      path = url; sent = init;
      return new Response("First Name\r\nSynthetic", { headers: { "content-type": "text/csv", ...(disposition ? { "content-disposition": disposition } : {}) } });
    });
    let saved: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => { saved = blob; return "blob:recovery"; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const link = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: () => link });
    await api.downloadRecoveryCsv(backupEvent.eventKey, "admin");
    expect(path).toBe(`/api/admin/backups/${backupEvent.eventKey}.csv`);
    expect(new Headers(sent?.headers).get("x-admin-passcode")).toBe("admin");
    expect(new Headers(sent?.headers).has("x-team-passcode")).toBe(false);
    expect(await saved?.text()).toBe("First Name\r\nSynthetic");
    expect(link.download).toBe("recovery-contacts.csv");
    expect(link.href).toBe("blob:recovery");
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:recovery");
  });

  it("uses the server CSV filename", async () => {
    vi.stubGlobal("fetch", async () => new Response("CSV", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="synthetic-fair.csv"' } }));
    vi.stubGlobal("URL", { createObjectURL: () => "blob:recovery", revokeObjectURL: () => {} });
    const link = { href: "", download: "", click: () => {} };
    vi.stubGlobal("document", { createElement: () => link });
    await api.downloadRecoveryCsv(backupEvent.eventKey, "admin");
    expect(link.download).toBe("synthetic-fair.csv");
  });

  it.each(["list", "download"])("signals expired admin authentication for %s without server details", async (action) => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "private details" }, { status: 401 }));
    const pending = action === "list" ? api.getBackupEvents("wrong") : api.downloadRecoveryCsv(backupEvent.eventKey, "wrong");
    await expect(pending).rejects.toMatchObject({ status: 401, message: "Administrator passcode was not accepted. Please unlock again." });
  });

  it("never persists the administrator secret in browser storage", async () => {
    const write = vi.fn(() => { throw new Error("Secret persistence"); });
    vi.stubGlobal("localStorage", { setItem: write });
    vi.stubGlobal("sessionStorage", { setItem: write });
    vi.stubGlobal("indexedDB", { open: write });
    vi.stubGlobal("fetch", async () => Response.json({ events: [], nextCursor: null }));
    await api.getBackupEvents("memory-only-secret");
    expect(write).not.toHaveBeenCalled();
  });

  it("does not download error pages as CSV or expose their details", async () => {
    vi.stubGlobal("fetch", async () => new Response("private SQL", { status: 503 }));
    await expect(api.downloadRecoveryCsv(backupEvent.eventKey, "admin")).rejects.toThrow("Cloud backups are temporarily unavailable. Please try again.");
    vi.stubGlobal("fetch", async () => new Response("HTML page", { headers: { "content-type": "text/html" } }));
    await expect(api.downloadRecoveryCsv(backupEvent.eventKey, "admin")).rejects.toThrow("Cloud backups are temporarily unavailable. Please try again.");
  });
});


describe("recovery download cancellation", () => {
  it("passes cancellation to fetch and refuses a late response after cancellation", async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", (_path: string, init: RequestInit) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const click = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ click }) });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:cancelled", revokeObjectURL: () => {} });
    const pending = api.downloadRecoveryCsv(backupEvent.eventKey, "admin", { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    finish(new Response("late CSV", { headers: { "content-type": "text/csv" } }));
    await rejected;
    expect(signal).toBe(controller.signal);
    expect(click).not.toHaveBeenCalled();
  });

  it("checks session validity again immediately before activating the download", async () => {
    let active = true;
    vi.stubGlobal("fetch", async () => new Response("CSV", { headers: { "content-type": "text/csv" } }));
    const click = vi.fn();
    vi.stubGlobal("document", { createElement: () => { active = false; return { click }; } });
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:cancelled", revokeObjectURL: revoke });
    await expect(api.downloadRecoveryCsv(backupEvent.eventKey, "admin", { isSessionActive: () => active })).rejects.toThrow();
    expect(click).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:cancelled");
  });
});
