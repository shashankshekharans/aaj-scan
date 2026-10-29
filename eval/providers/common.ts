// Shared plumbing for provider adapters: HTTP with timeout, and mapping
// provider errors onto three outcomes the runner (and later the Worker's
// failover) understands.

export interface ProviderCall {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  schema: object;
}

export interface Provider {
  id: string;
  /** Env vars this provider needs; missing ones mean "not configured". */
  requiredEnv: string[];
  model(): string;
  /** Returns the model's raw text answer (expected to be JSON). */
  extract(call: ProviderCall): Promise<string>;
}

/** Temporary rate limit: wait and retry the same provider. */
export class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterMs: number | null) {
    super(message);
  }
}

/** Daily/monthly free allowance used up: stop using this provider for now. */
export class QuotaExhaustedError extends Error {}

/** The provider rejected the request shape (e.g. unsupported schema option). */
export class BadRequestError extends Error {}

const QUOTA_HINT = /daily|per day|quota|free allocation|neurons|3036|monthly|limit.*exceeded.*plan/i;

export function parseRetryAfter(headers: Headers, body: string): number | null {
  const h = headers.get("retry-after");
  if (h && !Number.isNaN(Number(h))) return Number(h) * 1000;
  // Google style: "retryDelay": "17s"
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

export function classifyHttpError(status: number, headers: Headers, body: string): Error {
  const snippet = body.slice(0, 400);
  if (status === 429) {
    const retry = parseRetryAfter(headers, body);
    // A long or absent retry hint combined with quota wording means the daily
    // allowance is gone; short waits are ordinary per-minute limits.
    if (QUOTA_HINT.test(body) && (retry === null || retry > 120_000)) {
      return new QuotaExhaustedError(`429 quota exhausted: ${snippet}`);
    }
    return new RateLimitError(`429 rate limited: ${snippet}`, retry);
  }
  if (status === 400 || status === 422) return new BadRequestError(`${status}: ${snippet}`);
  if (status === 401 || status === 403) return new Error(`${status} auth failed — check the API key: ${snippet}`);
  return new Error(`${status}: ${snippet}`);
}

export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 90_000): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw classifyHttpError(res.status, res.headers, text);
  return JSON.parse(text);
}

/** Try the strict request first; if the provider rejects its shape, try the fallback. */
export async function withFallback<T>(strict: () => Promise<T>, loose: () => Promise<T>): Promise<T> {
  try {
    return await strict();
  } catch (e) {
    if (e instanceof BadRequestError) return loose();
    throw e;
  }
}

export const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
};

/** Pull the assistant text out of an OpenAI-style chat completion. */
export function chatText(json: unknown): string {
  const c = (json as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join("");
  throw new Error(`Unexpected response shape: ${JSON.stringify(json).slice(0, 300)}`);
}
