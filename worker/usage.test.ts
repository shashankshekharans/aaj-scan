import { describe, expect, it } from "vitest";
import {
  aggregateUsageRows,
  normalizeUsageEvent,
  parseUsageLimits,
  readUsageSnapshot,
  recordUsageEvents,
  type UsageDatabase,
} from "./usage";

const now = Date.parse("2026-11-01T12:00:00.000Z");

describe("normalizeUsageEvent", () => {
  it("keeps only privacy-safe operational metadata", () => {
    expect(normalizeUsageEvent({
      scanId: "scan_01",
      occurredAt: now,
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      status: "success",
      tokens: 123.8,
      fallbackUsed: false,
      email: "must-not-survive@example.com",
    })).toEqual({
      scanId: "scan_01",
      occurredAt: now,
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      status: "success",
      tokens: 123,
      fallbackUsed: false,
    });
  });

  it("rejects invalid identifiers and converts invalid token counts to null", () => {
    expect(normalizeUsageEvent({
      scanId: "scan_02",
      occurredAt: now,
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      status: "success",
      tokens: -10,
      fallbackUsed: false,
    })?.tokens).toBeNull();
    expect(normalizeUsageEvent({
      scanId: "contains spaces",
      occurredAt: now,
      provider: "unknown",
      model: "bad/model",
      status: "success",
    })).toBeNull();
  });
});

describe("parseUsageLimits", () => {
  it("accepts positive model limits and ignores malformed entries", () => {
    expect(parseUsageLimits("gemini-3.5-flash-lite:100, invalid, gemini-3.1-flash-lite:-5, gemini-3.8-flash:40.9")).toEqual({
      "gemini-3.5-flash-lite": 100,
      "gemini-3.8-flash": 40,
    });
  });
});

describe("aggregateUsageRows", () => {
  it("uses a UTC day window and counts one completed scan across model retries", () => {
    const snapshot = aggregateUsageRows([
      { scanId: "yesterday", occurredAt: Date.parse("2026-10-31T23:59:59.999Z"), provider: "gemini", model: "gemini-3.5-flash-lite", status: "success", tokens: 50, fallbackUsed: false },
      { scanId: "scan_a", occurredAt: Date.parse("2026-11-01T08:00:00.000Z"), provider: "gemini", model: "gemini-3.5-flash-lite", status: "rate_limited", tokens: null, fallbackUsed: false },
      { scanId: "scan_a", occurredAt: Date.parse("2026-11-01T08:00:01.000Z"), provider: "gemini", model: "gemini-3.1-flash-lite", status: "success", tokens: 120, fallbackUsed: true },
      { scanId: "scan_b", occurredAt: Date.parse("2026-11-01T09:00:00.000Z"), provider: "cloudflare", model: "@cf/google/gemma-4-26b-a4b-it", status: "success", tokens: null, fallbackUsed: true },
    ], {}, now);

    expect(snapshot.windowStart).toBe("2026-11-01T00:00:00.000Z");
    expect(snapshot.scans).toBe(2);
    expect(snapshot.geminiScans).toBe(1);
    expect(snapshot.cloudflareScans).toBe(1);
    expect(snapshot.tokens).toBe(120);
    expect(snapshot.fallbacks).toBe(2);
    expect(snapshot.rateLimitedModels).toEqual(["gemini-3.5-flash-lite"]);
    expect(snapshot.activeModel).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(snapshot.state).toBe("limited");
  });

  it("computes per-model and total estimated remaining requests", () => {
    const snapshot = aggregateUsageRows([
      { scanId: "scan_a", occurredAt: now - 2_000, provider: "gemini", model: "gemini-3.5-flash-lite", status: "success", tokens: 100, fallbackUsed: false },
      { scanId: "scan_b", occurredAt: now - 1_000, provider: "gemini", model: "gemini-3.5-flash-lite", status: "success", tokens: 90, fallbackUsed: false },
      { scanId: "scan_c", occurredAt: now, provider: "gemini", model: "gemini-3.1-flash-lite", status: "success", tokens: 80, fallbackUsed: true },
    ], { "gemini-3.5-flash-lite": 5, "gemini-3.1-flash-lite": 4 }, now);

    expect(snapshot.estimatedRemaining).toBe(6);
    expect(snapshot.models).toEqual([
      { model: "gemini-3.5-flash-lite", requests: 2, tokens: 190, limit: 5, estimatedRemaining: 3, rateLimited: false },
      { model: "gemini-3.1-flash-lite", requests: 1, tokens: 80, limit: 4, estimatedRemaining: 3, rateLimited: false },
    ]);
    expect(snapshot.state).toBe("fallback");
  });

  it("returns a healthy empty snapshot when no calls were made today", () => {
    const snapshot = aggregateUsageRows([], {}, now);
    expect(snapshot).toMatchObject({ scans: 0, tokens: 0, fallbacks: 0, state: "healthy", estimatedRemaining: null, updatedAt: null });
  });
});

function fakeDatabase(rows: unknown[] = [], failRead = false) {
  const batches: { query: string; values: unknown[] }[][] = [];
  const queries: { query: string; values: unknown[] }[] = [];
  const db: UsageDatabase = {
    prepare(query) {
      return {
        bind(...values) {
          const statement = {
            query,
            values,
            async all() {
              queries.push({ query, values });
              if (failRead) throw new Error("database offline: private detail");
              return { results: rows };
            },
          };
          return statement;
        },
      };
    },
    async batch(statements) {
      batches.push(statements.map((statement) => ({ query: statement.query!, values: statement.values! })));
      return [];
    },
  };
  return { db, batches, queries };
}

describe("D1 usage persistence", () => {
  it("writes normalized events with a parameterized batch and drops invalid events", async () => {
    const { db, batches } = fakeDatabase();
    await recordUsageEvents(db, [
      { scanId: "scan_01", occurredAt: now, provider: "gemini", model: "gemini-3.5-flash-lite", status: "success", tokens: 123.9, fallbackUsed: false, email: "do-not-store@example.com" },
      { scanId: "invalid id", occurredAt: now, provider: "gemini", model: "gemini-3.5-flash-lite", status: "success", tokens: 1, fallbackUsed: false },
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]![0]!.query).toContain("INSERT INTO usage_events");
    expect(batches[0]![0]!.query).toContain("VALUES (?, ?, ?, ?, ?, ?, ?)");
    expect(batches[0]![0]!.values).toEqual(["scan_01", now, "gemini", "gemini-3.5-flash-lite", "success", 123, 0]);
    expect(JSON.stringify(batches)).not.toContain("do-not-store@example.com");
  });

  it("reads today's rows and returns a shared aggregate", async () => {
    const { db, queries } = fakeDatabase([
      { scanId: "scan_01", occurredAt: now - 1_000, provider: "gemini", model: "gemini-3.5-flash-lite", status: "success", tokens: 100, fallbackUsed: 0 },
    ]);
    const snapshot = await readUsageSnapshot(db, { now, limits: { "gemini-3.5-flash-lite": 10 } });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toContain("FROM usage_events");
    expect(queries[0]!.values).toEqual([Date.parse("2026-11-01T00:00:00.000Z"), now]);
    expect(snapshot).toMatchObject({ source: "shared", scans: 1, tokens: 100, estimatedRemaining: 9 });
  });

  it("returns a safe unavailable snapshot when D1 cannot be read", async () => {
    const { db } = fakeDatabase([], true);
    await expect(readUsageSnapshot(db, { now, limits: {} })).resolves.toMatchObject({
      source: "unavailable",
      scans: 0,
      state: "healthy",
      updatedAt: null,
    });
  });
});
