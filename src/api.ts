import type { Extraction } from "../core/types";
import type { BatchRecord, CardRecord } from "./db";
import { backupTextIssue, BackupTextError } from "./backup-validation";
import { blobToBase64 } from "./image";

export interface ExtractionUsage {
  tokens: number | null;
  attemptedModels: string[];
  rateLimitedModels: string[];
  fallbackUsed: boolean;
}

export interface SharedUsage {
  source: "shared" | "unavailable";
  scans: number;
  geminiScans: number;
  cloudflareScans: number;
  tokens: number;
  fallbacks: number;
  rateLimitedModels: string[];
  activeModel: string | null;
  state: "healthy" | "fallback" | "limited";
  estimatedRemaining: number | null;
  updatedAt: number | null;
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

export const getUsage = (passcode: string) => request<SharedUsage>("/api/usage", passcode);

export async function extractCard(image: Blob, passcode: string) {
  return request<{ provider: string; model: string; usage: ExtractionUsage; extraction: Extraction }>("/api/extract", passcode, {
    method: "POST",
    body: JSON.stringify({ imageBase64: await blobToBase64(image), mimeType: "image/jpeg" }),
  });
}

export interface BackupReceipt {
  contactId: string;
  contactRevision: number;
  backedUpAt: number;
}

export const BACKUP_ERROR = "Could not back up this contact. Please try again.";

export async function backupContact(card: CardRecord, batch: BatchRecord, passcode: string): Promise<BackupReceipt> {
  if (card.state !== "approved") throw new Error(BACKUP_ERROR);
  const issue = backupTextIssue(card.fields, batch.eventName);
  if (issue) throw new BackupTextError(issue);
  if (!Number.isSafeInteger(card.contactRevision) || (card.contactRevision ?? 0) < 1 || !batch.eventDate) throw new Error(BACKUP_ERROR);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    // Explicit allowlist: neither photographs nor extraction/backup metadata is sent.
    const receipt = await request<BackupReceipt>("/api/backup/contacts", passcode, {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        contactId: card.id, contactRevision: card.contactRevision, batchId: batch.id, eventName: batch.eventName, eventDate: batch.eventDate,
        fields: {
          firstName: card.fields?.firstName ?? null, lastName: card.fields?.lastName ?? null,
          company: card.fields?.company ?? null, email: card.fields?.email ?? null,
          jobTitle: card.fields?.jobTitle ?? null, phone: card.fields?.phone ?? null,
        },
        provider: card.provider ?? null, model: card.model ?? null,
        cardCreatedAt: card.createdAt, approvedAt: card.approvedAt ?? card.backupUpdatedAt ?? card.createdAt,
      }),
    });
    if (receipt?.contactId !== card.id || receipt.contactRevision !== card.contactRevision || !Number.isSafeInteger(receipt.backedUpAt) || receipt.backedUpAt <= 0) throw new Error(BACKUP_ERROR);
    return receipt;
  } catch {
    throw new Error(BACKUP_ERROR);
  } finally {
    clearTimeout(timeout);
  }
}


export interface BackupEventSummary {
  eventKey: string;
  eventName: string;
  eventDate: string;
  contactCount: number;
  lastBackupAt: number;
}

export interface BackupEventPage {
  events: BackupEventSummary[];
  nextCursor: string | null;
}

export class AdminBackupError extends Error {
  constructor(public readonly status = 0) {
    super(status === 401
      ? "Administrator passcode was not accepted. Please unlock again."
      : "Cloud backups are temporarily unavailable. Please try again.");
  }
}

async function adminRequest(path: string, passcode: string, signal?: AbortSignal) {
  try {
    signal?.throwIfAborted();
    const response = await fetch(path, { headers: { "x-admin-passcode": passcode }, cache: "no-store", signal });
    signal?.throwIfAborted();
    if (!response.ok) throw new AdminBackupError(response.status);
    return response;
  } catch (error) {
    throw error instanceof AdminBackupError ? error : new AdminBackupError();
  }
}

const eventKeyPattern = /^[a-f0-9]{64}$/;

export async function getBackupEvents(passcode: string, cursor?: string, signal?: AbortSignal): Promise<BackupEventPage> {
  const response = await adminRequest(`/api/admin/backups${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, passcode, signal);
  try {
    const body = await response.json() as BackupEventPage;
    if (!Array.isArray(body.events) || !(body.nextCursor === null || (typeof body.nextCursor === "string" && eventKeyPattern.test(body.nextCursor)))) throw new Error();
    const events = body.events.map((event) => {
      if (!event || typeof event.eventKey !== "string" || !eventKeyPattern.test(event.eventKey)
        || typeof event.eventName !== "string" || !event.eventName.trim()
        || typeof event.eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.eventDate)
        || !Number.isSafeInteger(event.contactCount) || event.contactCount < 1
        || !Number.isSafeInteger(event.lastBackupAt) || event.lastBackupAt <= 0 || !Number.isFinite(new Date(event.lastBackupAt).getTime())
        || new Date(`${event.eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== event.eventDate) throw new Error();
      // Keep event metadata only; contact fields are never recovery-screen state.
      return { eventKey: event.eventKey, eventName: event.eventName, eventDate: event.eventDate,
        contactCount: event.contactCount, lastBackupAt: event.lastBackupAt };
    });
    return { events, nextCursor: body.nextCursor };
  } catch {
    throw new AdminBackupError();
  }
}

export async function downloadRecoveryCsv(eventKey: string, passcode: string, session: {
  signal?: AbortSignal;
  isSessionActive?: () => boolean;
} = {}): Promise<void> {
  const checkSession = () => {
    session.signal?.throwIfAborted();
    if (session.isSessionActive?.() === false) throw new AdminBackupError();
  };
  if (!eventKeyPattern.test(eventKey)) throw new AdminBackupError();
  const response = await adminRequest(`/api/admin/backups/${eventKey}.csv`, passcode, session.signal);
  try {
    checkSession();
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/csv")) throw new Error();
    const serverFilename = /filename="([^"]+)"/i.exec(response.headers.get("content-disposition") ?? "")?.[1];
    const filename = serverFilename && /^[a-z0-9][a-z0-9._-]*\.csv$/i.test(serverFilename) ? serverFilename : "recovery-contacts.csv";
    const blob = await response.blob();
    checkSession();
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      checkSession();
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    throw new AdminBackupError();
  }
}
