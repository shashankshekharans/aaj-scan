import type { Extraction } from "../core/types";
import { blobToBase64 } from "./image";

export interface ExtractionUsage {
  tokens: number | null;
  attemptedModels: string[];
  rateLimitedModels: string[];
  fallbackUsed: boolean;
}

async function request<T>(path: string, passcode: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-team-passcode": passcode, ...init?.headers },
  });
  const body = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export const checkPasscode = (passcode: string) =>
  request<{ providers: { id: string; status: string }[] }>("/api/status", passcode);

export async function extractCard(image: Blob, passcode: string) {
  return request<{ provider: string; model: string; usage: ExtractionUsage; extraction: Extraction }>("/api/extract", passcode, {
    method: "POST",
    body: JSON.stringify({ imageBase64: await blobToBase64(image), mimeType: "image/jpeg" }),
  });
}
