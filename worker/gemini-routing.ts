export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
] as const;

export class GeminiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

export function geminiModelOrder(configured?: string) {
  const requested = (configured ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => /^gemini-[a-z0-9.-]+$/i.test(model));
  return [...new Set([...requested, ...DEFAULT_GEMINI_MODELS])].slice(0, 5);
}

export function shouldRetryGemini(error: unknown) {
  return error instanceof GeminiHttpError && [408, 500, 502, 503, 504].includes(error.status);
}

export function shouldRotateGeminiModel(error: unknown) {
  if (!(error instanceof GeminiHttpError)) return true;
  return [404, 408, 429, 500, 502, 503, 504].includes(error.status);
}

export function retryDelay(error: GeminiHttpError, attempt: number) {
  if (error.retryAfterMs !== null) return Math.min(error.retryAfterMs, 4_000);
  return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), 4_000);
}
