import { describe, expect, it } from "vitest";
import worker, { createAdminAuthLimiter, createWorker } from "./index";

function environment() {
  let reads = 0;
  return {
    env: {
      TEAM_PASSCODE: "correct-passcode",
      GEMINI_API_KEY: "unused",
      GEMINI_DAILY_LIMITS: "gemini-3.5-flash-lite:10",
      USAGE_DB: {
        prepare() {
          return {
            bind() {
              return {
                async all() {
                  reads += 1;
                  return { results: [] };
                },
              };
            },
          };
        },
        async batch() { return []; },
      },
    },
    reads: () => reads,
  };
}

describe("GET /api/usage", () => {
  it("rejects an unauthenticated request without reading D1", async () => {
    const fixture = environment();
    const response = await worker.fetch(new Request("https://example.test/api/usage"), fixture.env as never);
    expect(response.status).toBe(401);
    expect(fixture.reads()).toBe(0);
  });

  it("returns the shared privacy-safe snapshot for an authenticated request", async () => {
    const fixture = environment();
    const response = await worker.fetch(new Request("https://example.test/api/usage", {
      headers: { "x-team-passcode": "correct-passcode" },
    }), fixture.env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "shared", scans: 0, estimatedRemaining: null });
    expect(fixture.reads()).toBe(1);
  });
});

describe("authentication rate limiting", () => {
  const blockingLimiter = (keys: string[]) => ({
    async limit({ key }: { key: string }) {
      keys.push(key);
      return { success: false };
    },
  });

  it("returns a neutral 429 for a blocked team authentication attempt and uses the fallback key", async () => {
    const fixture = environment();
    const keys: string[] = [];
    const response = await createWorker().fetch(new Request("https://example.test/api/status", {
      headers: { "x-team-passcode": "wrong" },
    }), { ...fixture.env, AUTH_RATE_LIMITER: blockingLimiter(keys) } as never);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "Too many attempts. Please wait and try again." });
    expect(keys).toEqual(["unknown"]);
  });

  it("returns the same neutral 429 for a blocked administrator attempt keyed by connecting IP", async () => {
    const fixture = backupEnvironment();
    const keys: string[] = [];
    const response = await createWorker({ adminAuthLimiter: { async failed() {} } }).fetch(
      backupRequest("/api/admin/backups", { "x-admin-passcode": "wrong", "cf-connecting-ip": "192.0.2.10" }),
      { ...fixture.env, ADMIN_RATE_LIMITER: blockingLimiter(keys) } as never,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "Too many attempts. Please wait and try again." });
    expect(keys).toEqual(["192.0.2.10"]);
    expect(fixture.reads()).toBe(0);
  });

  it("does not consume rate-limit capacity for valid credentials", async () => {
    const fixture = environment();
    const keys: string[] = [];
    const response = await createWorker().fetch(new Request("https://example.test/api/status", {
      headers: { "x-team-passcode": "correct-passcode", "cf-connecting-ip": "192.0.2.11" },
    }), { ...fixture.env, AUTH_RATE_LIMITER: blockingLimiter(keys) } as never);

    expect(response.status).toBe(200);
    expect(keys).toEqual([]);
  });

  it("fails open when the Cloudflare rate-limit binding is unavailable", async () => {
    const fixture = environment();
    const response = await createWorker().fetch(new Request("https://example.test/api/status", {
      headers: { "x-team-passcode": "wrong" },
    }), { ...fixture.env, AUTH_RATE_LIMITER: { async limit() { throw new Error("binding unavailable"); } } } as never);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Incorrect team passcode" });
  });
});

// Backup endpoint tests use an external D1 boundary double; SQL/migration behavior is
// exercised against real SQLite in backup.test.ts.

function backupEnvironment(fail = false) {
  let reads = 0;
  let writes = 0;
  return {
    env: {
      ...environment().env,
      BACKUP_ADMIN_PASSCODE: "admin-only-passcode",
      BACKUP_DB: {
        prepare(sql: string) {
          return { bind() { return {
            async all() { reads++; if (fail) throw new Error("SQL private contact ada@example.test"); return { results: sql.includes("contact_revision AS contactRevision") ? [{ contactId: "contact-01", contactRevision: 1, backedUpAt: 3000 }] : [] }; },
            async run() { writes++; if (fail) throw new Error("SQL private contact ada@example.test"); return { success: true }; },
          }; } };
        },
      },
    },
    reads: () => reads,
    writes: () => writes,
  };
}
const backupBody = {
  contactId: "contact-01", contactRevision: 1, batchId: "batch-phone-a", eventName: "AAJ Expo", eventDate: "2026-11-02",
  fields: { firstName: "Ada", lastName: null, company: null, email: "ada@example.test", jobTitle: null, phone: null },
  provider: "gemini", model: "gemini-3.5-flash-lite", cardCreatedAt: 1000, approvedAt: 2000,
};
const backupRequest = (path: string, headers: Record<string, string> = {}, body?: unknown) => new Request(`https://example.test${path}`, {
  headers, method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body),
});
const adminHeaders = { "x-admin-passcode": "admin-only-passcode" };
const teamHeaders = { "x-team-passcode": "correct-passcode" };

describe("backup authentication and routes", () => {
  it("permits team writes with a no-store acknowledgement", async () => {
    const fixture = backupEnvironment();
    const handler = createWorker({ now: () => 3000 });
    const response = await handler.fetch(backupRequest("/api/backup/contacts", teamHeaders, backupBody), fixture.env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ contactId: "contact-01", contactRevision: 1, backedUpAt: 3000 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.writes()).toBe(1);
  });
  it.each(["/api/admin/backups", `/api/admin/backups/${"a".repeat(64)}.csv`])("denies team-only recovery access without reading D1: %s", async (path) => {
    const fixture = backupEnvironment();
    const response = await worker.fetch(backupRequest(path, teamHeaders), fixture.env as never);
    expect(response.status).toBe(401);
    expect(fixture.reads()).toBe(0);
  });
  it("uses administrator auth without requiring the team secret", async () => {
    const fixture = backupEnvironment();
    const response = await worker.fetch(backupRequest("/api/admin/backups?limit=1", adminHeaders), fixture.env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [], nextCursor: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.reads()).toBe(1);
  });
  it("rejects administrator credentials as team write credentials", async () => {
    const fixture = backupEnvironment();
    for (const headers of [adminHeaders, { "x-team-passcode": "admin-only-passcode" }]) {
      expect((await worker.fetch(backupRequest("/api/backup/contacts", headers, backupBody), fixture.env as never)).status).toBe(401);
    }
    expect(fixture.writes()).toBe(0);
  });
  it("rejects invalid or unconfigured administrator secrets without D1 access", async () => {
    const fixture = backupEnvironment();
    const handler = createWorker({ adminAuthLimiter: { async failed() {} } });
    for (const headers of [{}, { "x-admin-passcode": "wrong" }] as Record<string, string>[]) {
      expect((await handler.fetch(backupRequest("/api/admin/backups", headers), fixture.env as never)).status).toBe(401);
    }
    fixture.env.BACKUP_ADMIN_PASSCODE = "";
    expect((await handler.fetch(backupRequest("/api/admin/backups", adminHeaders), fixture.env as never)).status).toBe(401);
    expect(fixture.reads()).toBe(0);
  });
  it("delays repeated invalid admin authentication with bounded delay and expiration via an injectable clock", async () => {
    let clock = 0;
    const delays: number[] = [];
    const limiter = createAdminAuthLimiter({ now: () => clock, sleep: async (delay) => { delays.push(delay); } });
    const handler = createWorker({ adminAuthLimiter: limiter });
    const fixture = backupEnvironment();
    for (let i = 0; i < 12; i++) {
      expect((await handler.fetch(backupRequest("/api/admin/backups", { "cf-connecting-ip": "192.0.2.1" }), fixture.env as never)).status).toBe(401);
    }
    expect(delays.length).toBeGreaterThan(0);
    expect(delays.every((delay) => delay > 0 && delay <= 2000)).toBe(true);
    expect(delays.at(-1)).toBe(2000);
    const previous = delays.length;
    clock = 60_001;
    await handler.fetch(backupRequest("/api/admin/backups", { "cf-connecting-ip": "192.0.2.1" }), fixture.env as never);
    expect(delays).toHaveLength(previous);
    expect(fixture.reads()).toBe(0);
  });
  it("returns safe validation and database errors without contact values", async () => {
    const fixture = backupEnvironment(true);
    const handler = createWorker();
    const invalid = await handler.fetch(backupRequest("/api/backup/contacts", teamHeaders, { ...backupBody, fields: "ada@example.test" }), fixture.env as never);
    expect(invalid.status).toBe(400);
    const write = await handler.fetch(backupRequest("/api/backup/contacts", teamHeaders, backupBody), fixture.env as never);
    const read = await handler.fetch(backupRequest("/api/admin/backups", adminHeaders), fixture.env as never);
    expect(write.status).toBe(503);
    expect(read.status).toBe(503);
    expect(await write.text()).not.toContain("ada@example.test");
    expect(await read.text()).not.toContain("SQL");
  });
  it("rejects malformed JSON, oversized bodies and invalid pagination without D1 access", async () => {
    const fixture = backupEnvironment();
    const invalidJson = new Request("https://example.test/api/backup/contacts", { method: "POST", headers: teamHeaders, body: "{" });
    expect((await worker.fetch(invalidJson, fixture.env as never)).status).toBe(400);
    expect((await worker.fetch(backupRequest("/api/backup/contacts", teamHeaders, { ...backupBody, extra: "x".repeat(40_000) }), fixture.env as never)).status).toBe(400);
    for (const query of ["limit=-1", "limit=nope", "cursor=bad"]) {
      expect((await worker.fetch(backupRequest(`/api/admin/backups?${query}`, adminHeaders), fixture.env as never)).status).toBe(400);
    }
    expect(fixture.reads()).toBe(0);
    expect(fixture.writes()).toBe(0);
  });
  it("returns not-found for an empty event CSV without exposing contacts", async () => {
    const fixture = backupEnvironment();
    const response = await worker.fetch(backupRequest(`/api/admin/backups/${"a".repeat(64)}.csv`, adminHeaders), fixture.env as never);
    expect(response.status).toBe(404);
    expect(fixture.reads()).toBe(1);
  });
  it("downloads a sanitized UTF-8 CSV attachment with no-store headers", async () => {
    const fixture = backupEnvironment();
    const env = { ...fixture.env, BACKUP_DB: { prepare() { return { bind() { return { async all() { return { results: [{ firstName: "=1", lastName: null, company: null, email: null, jobTitle: null, phone: null, eventName: '=Evil/"\r\nName' }] }; } }; } }; } } };
    const response = await worker.fetch(backupRequest(`/api/admin/backups/${"a".repeat(64)}.csv`, adminHeaders), env as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="evil-name.csv"');
    expect(await response.text()).toContain('"\'=1"');
  });
});
