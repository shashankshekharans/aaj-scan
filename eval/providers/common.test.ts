import { describe, expect, it } from "vitest";
import { BadRequestError, classifyHttpError, QuotaExhaustedError, RateLimitError, withFallback } from "./common";

const h = (o: Record<string, string> = {}) => new Headers(o);

describe("classifyHttpError", () => {
  it("treats a short 429 as a retryable rate limit", () => {
    const e = classifyHttpError(429, h({ "retry-after": "7" }), '{"error":{"message":"Rate limit reached for requests per minute"}}');
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterMs).toBe(7000);
  });

  it("reads Google's retryDelay", () => {
    const e = classifyHttpError(429, h(), '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"17s"}]}}');
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterMs).toBe(17000);
  });

  it("recognises Cloudflare's daily Neuron allowance", () => {
    const e = classifyHttpError(429, h(), '{"errors":[{"code":3036,"message":"You have used up your daily free allocation of 10,000 neurons"}]}');
    expect(e).toBeInstanceOf(QuotaExhaustedError);
  });

  it("treats quota wording with a short retry as a per-minute limit", () => {
    const e = classifyHttpError(429, h(), '{"error":{"message":"Quota exceeded for requests per minute","details":[{"retryDelay":"30s"}]}}');
    expect(e).toBeInstanceOf(RateLimitError);
  });

  it("maps 400 to BadRequestError", () => {
    expect(classifyHttpError(400, h(), "bad schema")).toBeInstanceOf(BadRequestError);
  });
});

describe("withFallback", () => {
  it("uses the fallback only for request-shape errors", async () => {
    expect(await withFallback(() => Promise.reject(new BadRequestError("x")), () => Promise.resolve("loose"))).toBe("loose");
    await expect(withFallback(() => Promise.reject(new Error("500")), () => Promise.resolve("loose"))).rejects.toThrow("500");
  });
});
