import { BACKUP_ERROR, backupContact } from "./api";
import { BackupTextError } from "./backup-validation";
import { db, getBatchForBackup, type CardRecord } from "./db";

export function selectBackupCandidates(cards: CardRecord[], now: number, limit = 10): CardRecord[] {
  return cards.filter((card) => card.state === "approved" && (card.backupState === "pending" || card.backupState === "failed")
    && (card.backupNextRetryAt ?? 0) <= now)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, Math.max(0, limit));
}

export function nextBackupRetry(attempts: number, now: number): number {
  return now + Math.min(30_000 * 2 ** Math.min(Math.max(0, attempts - 1), 6), 30 * 60_000);
}

function pendingBackup(card: CardRecord, now: number): Partial<CardRecord> {
  return { backupState: "pending", backupAttempts: 0, backupNextRetryAt: undefined, backupError: undefined,
    backupUpdatedAt: Math.max(now, (card.backupUpdatedAt ?? 0) + 1) };
}

// Approval/corrections are committed without waiting for a network operation.
export async function saveCardLocally(card: CardRecord, approve = false, now = Date.now()): Promise<void> {
  await db.transaction("rw", db.cards, async () => {
    const current = await db.cards.get(card.id);
    if (!current) return;
    const state = approve ? "approved" : current.state;
    const metadata = state === "approved"
      ? { ...pendingBackup(current, now), contactRevision: (current.contactRevision ?? 0) + 1, approvedAt: current.approvedAt ?? now }
      : {};
    await db.cards.put({ ...current, fields: card.fields, state, ...metadata });
  });
}

export async function retryBackup(id: string, now = Date.now()): Promise<void> {
  await db.transaction("rw", db.cards, async () => {
    const card = await db.cards.get(id);
    if (card?.state === "approved" && card.backupState === "failed") await db.cards.update(id, pendingBackup(card, now));
  });
}

interface CoordinatorOptions {
  upload?: typeof backupContact;
  isOnline?: () => boolean;
  now?: () => number;
  onChange?: () => void | Promise<void>;
}

// A stopped service may still have a request in flight. Keep passes ordered across
// coordinator instances so a replacement cannot upload before that request settles.
let previousPass: Promise<void> = Promise.resolve();

export function createBackupCoordinator(passcode: string, options: CoordinatorOptions = {}) {
  const { upload = backupContact, isOnline = () => navigator.onLine, now = Date.now } = options;
  let running: Promise<void> | null = null;
  let requested = false;

  async function finish(card: CardRecord, metadata: Partial<CardRecord>) {
    await db.transaction("rw", db.cards, async () => {
      const current = await db.cards.get(card.id);
      // A correction or retry changes this revision. Never acknowledge an older payload.
      if (current?.state === "approved" && current.backupState === card.backupState && current.backupUpdatedAt === card.backupUpdatedAt && current.contactRevision === card.contactRevision) {
        await db.cards.update(card.id, metadata);
      }
    });
  }

  async function sync() {
    if (!passcode || !isOnline()) return;
    const queued = await db.cards.where("backupState").anyOf("pending", "failed").toArray();
    for (const candidate of selectBackupCandidates(queued, now())) {
      if (!isOnline()) break;
      // Re-read in case a queued contact changed or was cleared while another uploaded.
      const card = await db.transaction("rw", db.cards, async () => {
        const current = await db.cards.get(candidate.id);
        if (current?.state === "approved" && current.backupState && current.contactRevision === undefined) {
          current.contactRevision = 1;
          await db.cards.put(current);
        }
        return current;
      });
      if (!card || !selectBackupCandidates([card], now()).length) continue;
      try {
        const batch = await getBatchForBackup(card.batchId);
        if (!batch) throw new Error(BACKUP_ERROR);
        const receipt = await upload(card, batch, passcode);
        if (receipt.contactId !== card.id || receipt.contactRevision !== card.contactRevision) throw new Error(BACKUP_ERROR);
        await finish(card, { backupState: "synced", backupAttempts: 0, backupNextRetryAt: undefined, backupError: undefined,
          backupUpdatedAt: Math.max(receipt.backedUpAt, (card.backupUpdatedAt ?? 0) + 1) });
      } catch (error) {
        if (!isOnline()) break;
        const attempts = (card.backupAttempts ?? 0) + 1;
        const timestamp = now();
        await finish(card, { backupState: "failed", backupAttempts: attempts, backupNextRetryAt: nextBackupRetry(attempts, timestamp),
          backupUpdatedAt: Math.max(timestamp, (card.backupUpdatedAt ?? 0) + 1), backupError: error instanceof BackupTextError ? error.message : BACKUP_ERROR });
      }
    }
    await options.onChange?.();
  }

  async function serializedSync() {
    const previous = previousPass;
    let release!: () => void;
    previousPass = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { await sync(); } finally { release(); }
  }

  return { run(): Promise<void> {
    requested = true;
    if (!running) running = (async () => {
      do { requested = false; await serializedSync(); } while (requested);
    })().finally(() => { running = null; });
    return running;
  } };
}

interface LifecycleOptions extends CoordinatorOptions {
  events?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  schedule?: (callback: () => void) => () => void;
}

// A bounded pass every 30 seconds drains larger queues and wakes due backoffs.
// Startup covers restored sessions; explicit runs cover approval and manual retry.
export function startBackupSync(passcode: string, options: LifecycleOptions = {}) {
  const { events = window, schedule = (callback) => {
    const timer = setInterval(callback, 30_000);
    return () => clearInterval(timer);
  } } = options;
  let active = true;
  const coordinator = createBackupCoordinator(passcode, { ...options, isOnline: () => active && (options.isOnline?.() ?? navigator.onLine) });
  const run = async () => {
    if (!active) return;
    // Storage/network problems must never interrupt scanning or local approval.
    try { await coordinator.run(); } catch { /* The next bounded pass can retry. */ }
  };
  const resume = () => { void run(); };
  events.addEventListener("online", resume);
  const cancel = schedule(resume);
  resume();
  return { run, stop() { active = false; cancel(); events.removeEventListener("online", resume); } };
}
