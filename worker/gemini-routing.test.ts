import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_MODELS,
  GeminiHttpError,
  geminiModelOrder,
  shouldRetryGemini,
  shouldRotateGeminiModel,
} from "./gemini-routing";

describe("Gemini model routing", () => {
  it("uses the evaluated primary model and stable fallbacks by default", () => {
    expect(geminiModelOrder()).toEqual(DEFAULT_GEMINI_MODELS);
  });

  it("puts configured models first and removes duplicates or invalid names", () => {
    expect(geminiModelOrder("gemini-custom, invalid/model, gemini-3.5-flash-lite")).toEqual([
      "gemini-custom",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.8-flash",
    ]);
  });

  it("rotates on quota, capacity and unavailable-model errors", () => {
    for (const status of [404, 408, 429, 500, 502, 503, 504]) {
      expect(shouldRotateGeminiModel(new GeminiHttpError(status, null, "failed"))).toBe(true);
    }
  });

  it("does not rotate for authentication or invalid-request errors", () => {
    for (const status of [400, 401, 403]) {
      expect(shouldRotateGeminiModel(new GeminiHttpError(status, null, "failed"))).toBe(false);
    }
  });

  it("retries transient errors but switches immediately for quota errors", () => {
    expect(shouldRetryGemini(new GeminiHttpError(503, null, "busy"))).toBe(true);
    expect(shouldRetryGemini(new GeminiHttpError(429, null, "quota"))).toBe(false);
  });
});
