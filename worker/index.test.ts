import { describe, expect, it } from "vitest";
import worker from "./index";

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
