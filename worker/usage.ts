export type UsageProvider = "gemini" | "cloudflare";
export type UsageStatus = "success" | "rate_limited" | "error";
export type CapacityState = "healthy" | "fallback" | "limited";

export interface UsageEvent {
  scanId: string;
  occurredAt: number;
  provider: UsageProvider;
  model: string;
  status: UsageStatus;
  tokens: number | null;
  fallbackUsed: boolean;
}

export interface ModelUsage {
  model: string;
  requests: number;
  tokens: number;
  limit: number | null;
  estimatedRemaining: number | null;
  rateLimited: boolean;
}

export interface UsageSnapshot {
  source: "shared" | "unavailable";
  windowStart: string;
  scans: number;
  geminiScans: number;
  cloudflareScans: number;
  tokens: number;
  fallbacks: number;
  rateLimitedModels: string[];
  activeModel: string | null;
  state: CapacityState;
  estimatedRemaining: number | null;
  models: ModelUsage[];
  updatedAt: number | null;
}

export type UsageLimits = Record<string, number>;

export function parseUsageLimits(value?: string): UsageLimits {
  const limits: UsageLimits = {};
  for (const entry of value?.split(",") ?? []) {
    const separator = entry.lastIndexOf(":");
    if (separator < 1) continue;
    const model = entry.slice(0, separator).trim();
    const limit = Number(entry.slice(separator + 1).trim());
    if (!GEMINI_MODEL.test(model) || !Number.isFinite(limit) || limit <= 0) continue;
    limits[model] = Math.floor(limit);
  }
  return limits;
}

export interface UsageBoundStatement {
  query?: string;
  values?: unknown[];
  all(): Promise<{ results?: unknown[] }>;
}

export interface UsagePreparedStatement {
  bind(...values: unknown[]): UsageBoundStatement;
}

export interface UsageDatabase {
  prepare(query: string): UsagePreparedStatement;
  batch(statements: UsageBoundStatement[]): Promise<unknown>;
}

const SCAN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GEMINI_MODEL = /^gemini-[a-z0-9.-]{1,120}$/i;
const CLOUDFLARE_MODEL = /^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i;

export function normalizeUsageEvent(input: unknown): UsageEvent | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const provider = value.provider;
  const model = value.model;
  const status = value.status;
  const occurredAt = value.occurredAt;
  const validModel = provider === "gemini"
    ? typeof model === "string" && GEMINI_MODEL.test(model)
    : provider === "cloudflare" && typeof model === "string" && CLOUDFLARE_MODEL.test(model);

  if (
    typeof value.scanId !== "string" || !SCAN_ID.test(value.scanId)
    || !validModel
    || !["success", "rate_limited", "error"].includes(String(status))
    || typeof occurredAt !== "number" || !Number.isFinite(occurredAt) || occurredAt <= 0
  ) return null;

  const numericTokens = typeof value.tokens === "number" && Number.isFinite(value.tokens) && value.tokens >= 0
    ? Math.floor(value.tokens)
    : null;
  return {
    scanId: value.scanId,
    occurredAt,
    provider: provider as UsageProvider,
    model: model as string,
    status: status as UsageStatus,
    tokens: numericTokens,
    fallbackUsed: value.fallbackUsed === true || value.fallbackUsed === 1,
  };
}

export function aggregateUsageRows(rows: unknown[], limits: UsageLimits, now = Date.now()): UsageSnapshot {
  const day = new Date(now);
  const windowStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const events = rows
    .map(normalizeUsageEvent)
    .filter((event): event is UsageEvent => event !== null && event.occurredAt >= windowStart && event.occurredAt <= now)
    .sort((left, right) => left.occurredAt - right.occurredAt);

  const successful = events.filter((event) => event.status === "success");
  const completedScans = new Set(successful.map((event) => event.scanId));
  const fallbackScans = new Set(successful.filter((event) => event.fallbackUsed).map((event) => event.scanId));
  const rateLimitedModels = [...new Set(events.filter((event) => event.status === "rate_limited").map((event) => event.model))];
  const modelMap = new Map<string, ModelUsage>();

  for (const event of events) {
    const rawLimit = limits[event.model];
    const configuredLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.floor(rawLimit)
      : null;
    const current = modelMap.get(event.model) ?? {
      model: event.model,
      requests: 0,
      tokens: 0,
      limit: configuredLimit,
      estimatedRemaining: configuredLimit,
      rateLimited: false,
    };
    current.requests += 1;
    current.tokens += event.tokens ?? 0;
    current.rateLimited ||= event.status === "rate_limited";
    current.estimatedRemaining = current.limit === null ? null : Math.max(current.limit - current.requests, 0);
    modelMap.set(event.model, current);
  }

  const models = [...modelMap.values()];
  const knownRemaining = models.filter((model) => model.estimatedRemaining !== null);
  const latestSuccess = successful.at(-1);
  return {
    source: "shared",
    windowStart: new Date(windowStart).toISOString(),
    scans: completedScans.size,
    geminiScans: new Set(successful.filter((event) => event.provider === "gemini").map((event) => event.scanId)).size,
    cloudflareScans: new Set(successful.filter((event) => event.provider === "cloudflare").map((event) => event.scanId)).size,
    tokens: events.reduce((total, event) => total + (event.tokens ?? 0), 0),
    fallbacks: fallbackScans.size,
    rateLimitedModels,
    activeModel: latestSuccess?.model ?? null,
    state: rateLimitedModels.length ? "limited" : fallbackScans.size ? "fallback" : "healthy",
    estimatedRemaining: knownRemaining.length
      ? knownRemaining.reduce((total, model) => total + (model.estimatedRemaining ?? 0), 0)
      : null,
    models,
    updatedAt: events.at(-1)?.occurredAt ?? null,
  };
}

const INSERT_USAGE = `INSERT INTO usage_events
  (scan_id, occurred_at, provider, model, status, tokens, fallback_used)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

const SELECT_USAGE = `SELECT
  scan_id AS scanId,
  occurred_at AS occurredAt,
  provider,
  model,
  status,
  tokens,
  fallback_used AS fallbackUsed
  FROM usage_events
  WHERE occurred_at >= ? AND occurred_at <= ?
  ORDER BY occurred_at ASC`;

export async function recordUsageEvents(db: UsageDatabase, inputs: unknown[]) {
  const events = inputs.map(normalizeUsageEvent).filter((event): event is UsageEvent => event !== null);
  if (!events.length) return;
  const statements = events.map((event) => db.prepare(INSERT_USAGE).bind(
    event.scanId,
    event.occurredAt,
    event.provider,
    event.model,
    event.status,
    event.tokens,
    event.fallbackUsed ? 1 : 0,
  ));
  await db.batch(statements);
}

export async function readUsageSnapshot(
  db: UsageDatabase,
  options: { limits: UsageLimits; now?: number },
): Promise<UsageSnapshot> {
  const now = options.now ?? Date.now();
  const date = new Date(now);
  const windowStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  try {
    const response = await db.prepare(SELECT_USAGE).bind(windowStart, now).all();
    return aggregateUsageRows(response.results ?? [], options.limits, now);
  } catch {
    return { ...aggregateUsageRows([], options.limits, now), source: "unavailable" };
  }
}
