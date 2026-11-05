import { afterEach, describe, expect, it, vi } from "vitest";
import { requestWakeLock } from "./wake-lock";

const setWakeLock = (wakeLock: unknown) => vi.stubGlobal("navigator", { wakeLock });

afterEach(() => vi.unstubAllGlobals());

describe("requestWakeLock", () => {
  it("returns the sentinel when the browser grants the lock", async () => {
    const sentinel = { release: vi.fn() };
    setWakeLock({ request: vi.fn().mockResolvedValue(sentinel) });
    expect(await requestWakeLock()).toBe(sentinel);
  });

  it("resolves to undefined instead of throwing when the browser refuses", async () => {
    // Battery saver, a hidden tab or a permissions policy all reject the request.
    setWakeLock({ request: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) });
    await expect(requestWakeLock()).resolves.toBeUndefined();
  });

  it("resolves to undefined when the API is unavailable", async () => {
    setWakeLock(undefined);
    await expect(requestWakeLock()).resolves.toBeUndefined();
  });
});
