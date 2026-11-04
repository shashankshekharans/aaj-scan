import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildCard } from "../core/postprocess";
import type { ContactFields, FieldName } from "../core/types";
import { AdminBackupError, checkPasscode, downloadRecoveryCsv, extractCard, getBackupEvents, getUsage, type BackupEventSummary, type SharedUsage } from "./api";
import { downloadCsv, shareCsv } from "./csv";
import { retryBackup, saveCardLocally, startBackupSync } from "./backup-sync";
import { backupTextIssue, CONTACT_FIELD_LIMITS, EVENT_NAME_LIMIT } from "./backup-validation";
import { createBatchLocally, db, type BatchRecord, type CardRecord, type CardState } from "./db";
import { prepareImage, runCombinedOcr } from "./image";

const emptyFields: ContactFields = { firstName: null, lastName: null, company: null, email: null, jobTitle: null, phone: null };
const fieldLabels: Record<FieldName, string> = {
  firstName: "First Name", lastName: "Last Name", company: "Company", email: "Work Email", jobTitle: "Job Title", phone: "Phone",
};

interface DeviceUsage {
  source: "device";
  scans: number;
  geminiScans: number;
  cloudflareScans: number;
  tokens: number;
  fallbacks: number;
  rateLimitedModels: string[];
  activeModel: string | null;
  state: "healthy" | "fallback" | "limited";
  estimatedRemaining: number | null;
}

function summarizeUsage(cards: CardRecord[]): DeviceUsage {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = cards.filter((card) => card.provider && (card.completedAt ?? card.createdAt) >= start.getTime());
  const rateLimitedModels = [...new Set(today.flatMap((card) => card.rateLimitedModels ?? []))];
  const latest = [...today].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))[0];
  const configuredLimit = Number(import.meta.env.VITE_GEMINI_DAILY_LIMIT ?? 0);
  const geminiScans = today.filter((card) => card.provider === "gemini").length;
  const fallbacks = today.filter((card) => card.fallbackUsed).length;
  return {
    source: "device",
    scans: today.length,
    geminiScans,
    cloudflareScans: today.filter((card) => card.provider === "cloudflare").length,
    tokens: today.reduce((total, card) => total + (card.usageTokens ?? 0), 0),
    fallbacks,
    rateLimitedModels,
    activeModel: latest?.model ?? null,
    state: rateLimitedModels.length ? "limited" : fallbacks ? "fallback" : "healthy",
    estimatedRemaining: Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.max(configuredLimit - geminiScans, 0) : null,
  };
}

function Thumb({ image, alt }: { image: Blob; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);
  return <img className="card-thumb" src={url || undefined} alt={alt} />;
}

function StatePill({ state }: { state: CardState }) {
  const label: Record<CardState, string> = {
    queued: "Queued", processing: "Reading", looks_good: "Looks Good", needs_review: "Check", skipped: "Skipped", approved: "Approved", error: "Retry",
  };
  return <span className={`pill pill-${state}`}>{label[state]}</span>;
}

type IconName = "camera" | "photos" | "scan" | "check" | "settings" | "back" | "chevron" | "close" | "lock" | "download" | "cards" | "github" | "instagram" | "x";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    camera: <><path d="M14 4h-4L8 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4z" /><circle cx="12" cy="13" r="4" /></>,
    photos: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 16 5-5 5 5 3-3 5 5" /></>,
    scan: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M3 12h18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
    back: <path d="m14 6-6 6 6 6M8 12h13" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
    cards: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10h4M7 14h10" /></>,
    github: <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.1.1 15 1.8a13.4 13.4 0 0 0-7 0C4.9.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 8 18v4m0-3c-3 .9-3-1.5-4-2" />,
    instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /></>,
    x: <path d="M4 4l16 16M20 4 4 20" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function BrandLogo({ className = "" }: { className?: string }) {
  return <img className={className} src="/AAJ_SCM_Logo.webp" width="360" height="115" alt="AAJ Supply Chain Management" fetchPriority="high" />;
}

export function SocialFooter() {
  const profiles: { label: string; href: string; icon: IconName }[] = [
    { label: "GitHub", href: "https://github.com/shashankshekharans", icon: "github" },
    { label: "Instagram", href: "https://www.instagram.com/shashankshekharans/", icon: "instagram" },
    { label: "X", href: "https://x.com/SHASHANK_ANS", icon: "x" },
  ];
  return <footer className="social-footer" aria-label="Social profiles">
    {profiles.map((profile) => <a key={profile.label} href={profile.href} target="_blank" rel="noopener noreferrer" aria-label={`${profile.label} profile`} title={profile.label}><Icon name={profile.icon} /></a>)}
  </footer>;
}

function Sheet({ children, titleId, onClose, className = "" }: { children: ReactNode; titleId: string; onClose(): void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return <dialog ref={ref} className="sheet-dialog" aria-labelledby={titleId} onCancel={onClose}>
    <section className={`editor-sheet ${className}`}>{children}</section>
  </dialog>;
}

export default function App() {
  const [passcode, setPasscode] = useState(() => sessionStorage.getItem("contact-scan-passcode") ?? "");
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const cameraInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const [authError, setAuthError] = useState("");
  const [providers, setProviders] = useState<{ id: string; status: string }[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [usageCards, setUsageCards] = useState<CardRecord[]>([]);
  const [sharedUsage, setSharedUsage] = useState<SharedUsage | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [eventName, setEventName] = useState("");
  const [selected, setSelected] = useState<CardRecord | null>(null);
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const [screen, setScreen] = useState<"scan" | "review" | "settings">("scan");
  const processing = useRef(false);
  const backupSync = useRef<ReturnType<typeof startBackupSync> | null>(null);

  async function shareApprovedCsv() {
    if (!batch || sharing) return;
    setSharing(true);
    setMessage("");
    try {
      const result = await shareCsv(batch, cards);
      if (result === "mail") setMessage("CSV downloaded. Attach the downloaded CSV to the email draft addressed to info@aajscm.com.");
    } catch {
      setMessage("Could not share the CSV. Please try again or use Download CSV.");
    } finally {
      setSharing(false);
    }
  }

  const refreshBatches = useCallback(async () => setBatches(await db.batches.orderBy("createdAt").reverse().toArray()), []);
  const refreshUsage = useCallback(async () => {
    setUsageCards(await db.cards.toArray());
    if (!passcode || !navigator.onLine) return setSharedUsage(null);
    try {
      const result = await getUsage(passcode);
      setSharedUsage(result.source === "shared" ? result : null);
    } catch {
      setSharedUsage(null);
    }
  }, [passcode]);
  const refreshCards = useCallback(async () => {
    if (!batch) return setCards([]);
    setCards(await db.cards.where("batchId").equals(batch.id).sortBy("createdAt"));
  }, [batch]);

  const refreshCardsRef = useRef(refreshCards);
  refreshCardsRef.current = refreshCards;
  useEffect(() => {
    if (!unlocked || !passcode) return;
    const service = startBackupSync(passcode, { onChange: () => refreshCardsRef.current() });
    backupSync.current = service;
    return () => { service.stop(); backupSync.current = null; };
  }, [unlocked, passcode]);
  useEffect(() => { void refreshBatches(); }, [refreshBatches]);
  useEffect(() => { void refreshCards(); }, [refreshCards]);
  useEffect(() => { if (unlocked) void refreshUsage(); }, [refreshUsage, unlocked]);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  const unlock = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setAuthError("");
    setUnlocking(true);
    try {
      const result = await checkPasscode(passcode);
      sessionStorage.setItem("contact-scan-passcode", passcode);
      setProviders(result.providers);
      setUnlocked(true);
    } catch (error) {
      if (import.meta.env.DEV && passcode === "local-preview-only") {
        sessionStorage.setItem("contact-scan-passcode", passcode);
        setProviders([{ id: "gemini", status: "preview" }, { id: "cloudflare", status: "preview" }]);
        setUnlocked(true);
        return;
      }
      setAuthError(error instanceof SyntaxError
        ? "The scanner is unavailable. Please try again."
        : error instanceof TypeError
          ? "Could not reach the scanner. Check your connection and try again."
          : error instanceof Error ? error.message : "Could not unlock. Please try again.");
    } finally {
      setUnlocking(false);
    }
  };

  useEffect(() => {
    if (passcode && !unlocked) void unlock();
    // Only check a restored passcode once on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processQueue = useCallback(async () => {
    if (!batch || processing.current || !navigator.onLine) return;
    processing.current = true;
    let wakeLock: { release(): Promise<void> } | undefined;
    try {
      wakeLock = await (navigator as Navigator & { wakeLock?: { request(): Promise<{ release(): Promise<void> }> } }).wakeLock?.request();
      while (navigator.onLine) {
        const card = await db.cards.where("batchId").equals(batch.id).filter((item) => item.state === "queued" || item.state === "error").first();
        if (!card) break;
        await db.cards.update(card.id, { state: "processing", error: undefined });
        await refreshCards();
        try {
          const [ocrText, response] = await Promise.all([runCombinedOcr(card.image), extractCard(card.image, passcode)]);
          const result = buildCard(response.extraction, ocrText);
          const state: CardState = result.status.kind === "skipped" ? "skipped" : result.status.kind;
          await db.cards.update(card.id, {
            state,
            provider: response.provider,
            model: response.model,
            usageTokens: response.usage.tokens ?? undefined,
            fallbackUsed: response.usage.fallbackUsed,
            rateLimitedModels: response.usage.rateLimitedModels,
            completedAt: Date.now(),
            fields: result.fields,
            flags: result.flags,
            skipReason: result.status.kind === "skipped" ? result.status.reason : undefined,
          });
        } catch (error) {
          const offline = !navigator.onLine;
          await db.cards.update(card.id, { state: offline ? "queued" : "error", error: error instanceof Error ? error.message : "Extraction failed" });
          if (!offline) break;
        }
        await refreshCards();
        await refreshUsage();
      }
    } finally {
      await wakeLock?.release();
      processing.current = false;
      await refreshCards();
    }
  }, [batch, passcode, refreshCards, refreshUsage]);

  useEffect(() => {
    const resume = () => void processQueue();
    window.addEventListener("online", resume);
    void processQueue();
    return () => window.removeEventListener("online", resume);
  }, [processQueue]);

  const createBatch = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = eventName.trim();
    if (!name || name.length > EVENT_NAME_LIMIT) { setMessage("Use an event name of 1 to 200 characters."); return; }
    const next = await createBatchLocally(name);
    setEventName("");
    setBatch(next);
    setScreen("scan");
    await refreshBatches();
  };

  const addPhotos = async (files: FileList | null) => {
    if (!batch || !files?.length) return;
    setMessage("Preparing photos…");
    for (const file of Array.from(files)) {
      const prepared = await prepareImage(file);
      if (prepared.warning && !window.confirm(`${prepared.warning}\n\nUse this photo anyway?`)) continue;
      await db.cards.add({
        id: crypto.randomUUID(), batchId: batch.id, createdAt: Date.now(), image: prepared.blob,
        state: "queued", qualityWarning: prepared.warning,
      });
    }
    setMessage(navigator.onLine ? "Photos queued for extraction." : "Saved offline. Processing will resume when connected.");
    await refreshCards();
    void processQueue();
  };

  const approveClean = async () => {
    const clean = cards.filter((card) => card.state === "looks_good");
    await Promise.all(clean.map((card) => saveCardLocally(card, true)));
    await refreshCards();
    void backupSync.current?.run();
  };

  const saveSelected = async (approve = false) => {
    if (!selected) return;
    await saveCardLocally(selected, approve);
    setSelected(null);
    await refreshCards();
    void backupSync.current?.run();
  };

  const retryContactBackup = async (card: CardRecord) => {
    await retryBackup(card.id);
    await refreshCards();
    void backupSync.current?.run();
  };
  const retry = async (card: CardRecord) => {
    await db.cards.update(card.id, { state: "queued", error: undefined });
    await refreshCards();
    void processQueue();
  };

  const clearBatch = async () => {
    if (!batch || !window.confirm("File saved? This permanently removes every photo and contact in this batch from this phone.")) return;
    await db.transaction("rw", db.cards, db.batches, async () => {
      await db.cards.where("batchId").equals(batch.id).delete();
      await db.batches.delete(batch.id);
    });
    setBatch(null);
    setCards([]);
    await refreshBatches();
  };

  const counts = useMemo(() => ({
    approved: cards.filter((card) => card.state === "approved").length,
    review: cards.filter((card) => card.state === "needs_review").length,
    clean: cards.filter((card) => card.state === "looks_good").length,
    pending: cards.filter((card) => ["queued", "processing", "error"].includes(card.state)).length,
  }), [cards]);
  const usage = useMemo(() => sharedUsage ?? summarizeUsage(usageCards), [sharedUsage, usageCards]);

  if (!unlocked) {
    return <main className="lock-shell">
      <section className="lock-card">
        <div className="brand-lockup"><BrandLogo /><small>Optimizing supply chains</small></div>
        <h1>Contact Scan</h1>
        <p className="lede">Turn a stack of business cards into a checked, HubSpot-ready file.</p>
        <form onSubmit={unlock}>
          <label>Team Passcode<input aria-invalid={!!authError} aria-describedby={authError ? "auth-error" : undefined} type="password" autoComplete="current-password" value={passcode} onChange={(event) => setPasscode(event.target.value)} required /></label>
          {authError && <p className="error-text" id="auth-error" role="alert">{authError}</p>}
          <button className="button primary" type="submit" disabled={unlocking} aria-busy={unlocking}><Icon name="lock" />{unlocking ? "Unlocking…" : "Unlock Scanner"}</button>
        </form>
        <p className="privacy-note">Photos are processed temporarily and stay on this phone until you clear the batch. Approved contact text is backed up centrally; photos are not backed up.</p>
      </section>
      <SocialFooter />
    </main>;
  }

  if (!batch) {
    return <main className="app-shell">
      {screen === "settings"
        ? <header className="topbar"><button className="back-button" aria-label="Back to Batches" onClick={() => setScreen("scan")}><Icon name="back" /></button><div className="batch-heading"><h1 className="topbar-title">Settings</h1></div><span role="status" className={`network ${online ? "online" : "offline"}`}>{online ? "Online" : "Offline"}</span></header>
        : <header className="topbar"><div><BrandLogo className="brand-logo" /><strong>Contact Scan</strong></div><span role="status" className={`network ${online ? "online" : "offline"}`}>{online ? "Online" : "Offline"}</span></header>}
      {screen === "settings" ?
        <SettingsPanel providers={providers} showTitle={false} onLock={() => { sessionStorage.removeItem("contact-scan-passcode"); setUnlocked(false); setPasscode(""); setScreen("scan"); }} /> : <>
      <section className="home-hero">
        <h1>Start With the Event.</h1>
        <p>Every approved contact will carry this event name into HubSpot.</p>
        <form className="event-form" onSubmit={createBatch}>
          <label>Event Name<input maxLength={EVENT_NAME_LIMIT} value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="e.g. India Warehousing Show 2026" required /></label>
          <button className="button primary" type="submit" disabled={!eventName.trim() || eventName.trim().length > EVENT_NAME_LIMIT}>Start Batch<Icon name="chevron" /></button>
        </form>
      </section>
      <CapacityCard usage={usage} onOpen={() => setUsageOpen(true)} />
      <div className="home-settings"><button className="settings-row" onClick={() => setScreen("settings")}><span><Icon name="settings" />Settings</span><Icon name="chevron" /></button></div>
      {batches.length > 0 && <section className="section"><div className="section-title"><h2>Continue a Batch</h2><span>{batches.length} on this phone</span></div>
        <div className="batch-list">{batches.map((item) => <button className="batch-item" key={item.id} onClick={() => setBatch(item)}><span><strong>{item.eventName}</strong><small>{new Date(item.createdAt).toLocaleDateString()}</small></span><Icon name="chevron" /></button>)}</div>
      </section>}
      </>}
      {usageOpen && <UsagePanel usage={usage} onClose={() => setUsageOpen(false)} />}
      <SocialFooter />
    </main>;
  }

  return <main className="app-shell with-nav">
    <header className="topbar"><button className="back-button" aria-label="Back to Batches" onClick={() => setBatch(null)}><Icon name="back" /></button><div className="batch-heading"><strong>{batch.eventName}</strong><small>{cards.length} {cards.length === 1 ? "Card" : "Cards"} on This Phone</small></div><span role="status" className={`network ${online ? "online" : "offline"}`}>{online ? "Online" : "Offline"}</span></header>

    {!online && <div className="offline-notice" role="status"><strong>You’re offline.</strong> Photos stay on this phone. Processing resumes when you reconnect.</div>}

    {screen === "scan" && <>
      <section className="scan-hero">
        <div className="capture-copy"><div className="capture-mark"><Icon name="scan" /></div><h1>Keep the card inside the frame.</h1>
        <p>Use bright, even light. One card per photo.</p></div>
        <div className="capture-actions">
          <button className="button primary camera-button" onClick={() => cameraInput.current?.click()}><Icon name="camera" />Open Camera</button><input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
          <button className="button secondary" onClick={() => photosInput.current?.click()}><Icon name="photos" />Choose Photos</button><input ref={photosInput} hidden type="file" accept="image/*" multiple onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
        </div>
        {message && <p className="message" role="status">{message}</p>}
      </section>
      <section className="stats-grid"><div><strong>{cards.length}</strong><span>Captured</span></div><div><strong>{counts.pending}</strong><span>Processing</span></div><div><strong>{counts.review}</strong><span>Need Checking</span></div></section>
      <CapacityCard usage={usage} onOpen={() => setUsageOpen(true)} compact />
      {cards.length > 0 && <section className="section"><div className="section-title"><h2>Latest Cards</h2><button className="text-button" onClick={() => setScreen("review")}>Review All<Icon name="chevron" /></button></div><CardList cards={cards.slice(-4).reverse()} onSelect={setSelected} onRetry={retry} onRetryBackup={retryContactBackup} /></section>}
    </>}

    {screen === "review" && <section className="section review-section">
      <div className="section-title"><div><h1>{counts.approved} Approved</h1></div>{counts.clean > 0 && <button className="button compact" onClick={approveClean}>Approve {counts.clean} Clean</button>}</div>
      <div className="review-summary"><span><i className="dot green" />{counts.clean} Look Good</span><span><i className="dot amber" />{counts.review} Check</span><span><i className="dot dark" />{counts.approved} Approved</span></div>
      <CardList cards={cards} onSelect={setSelected} onRetry={retry} onRetryBackup={retryContactBackup} />
      {backupTextIssue(undefined, batch.eventName) && <p className="flag-box" role="status">{backupTextIssue(undefined, batch.eventName)}</p>}
      <div className="export-panel"><div><strong>HubSpot Export</strong><span>{counts.approved} Approved {counts.approved === 1 ? "Contact" : "Contacts"}</span></div><div><button className="button primary" disabled={!counts.approved} onClick={() => downloadCsv(batch, cards)}><Icon name="download" />Download CSV</button><button className="button secondary" disabled={!counts.approved || sharing} onClick={() => { void shareApprovedCsv(); }}>{sharing ? "Sharing…" : "Share CSV"}</button></div></div>
      {message && <p className="message" role="status">{message}</p>}
      <button className="danger-button" onClick={clearBatch}>File Saved? Clear This Batch</button>
    </section>}

    {screen === "settings" && <SettingsPanel providers={providers} onLock={() => { sessionStorage.removeItem("contact-scan-passcode"); setUnlocked(false); setPasscode(""); setScreen("scan"); }} />}

    <nav className="bottom-nav" aria-label="Batch navigation"><button aria-current={screen === "scan" ? "page" : undefined} className={screen === "scan" ? "active" : ""} onClick={() => setScreen("scan")}><Icon name="scan" />Scan</button><button aria-current={screen === "review" ? "page" : undefined} className={screen === "review" ? "active" : ""} onClick={() => setScreen("review")}><Icon name="check" />Review</button><button aria-current={screen === "settings" ? "page" : undefined} className={screen === "settings" ? "active" : ""} onClick={() => setScreen("settings")}><Icon name="settings" />Settings</button></nav>

    {selected && <CardEditor card={selected} onChange={setSelected} onClose={() => setSelected(null)} onSave={saveSelected} />}
    {usageOpen && <UsagePanel usage={usage} onClose={() => setUsageOpen(false)} />}
  </main>;
}


export function providerStatusTone(status: string): "healthy" | "warning" | "error" {
  const normalized = status.trim().toLowerCase();
  if (["active", "ready", "healthy", "success", "preview"].includes(normalized)) return "healthy";
  if (["error", "failed", "unavailable", "missing", "inactive", "disabled"].includes(normalized)) return "error";
  return "warning";
}

function SettingsPanel({ providers, onLock, showTitle = true }: { providers: { id: string; status: string }[]; onLock(): void; showTitle?: boolean }) {
  return <section className="section settings-section">{showTitle && <h1>Settings</h1>}
    <h2>Provider Status</h2><p className="muted">Keys are encrypted in the Cloudflare Worker and are never sent to this phone.</p>
    <div className="provider-list">{providers.map((provider, index) => <div key={provider.id}><span className="provider-name"><i className={`status-light status-${providerStatusTone(provider.status)}`} aria-hidden="true" /><strong>{provider.id === "gemini" ? "Gemini" : "Cloudflare Workers AI"}</strong></span><span className="provider-role">{index === 0 ? "Primary" : "Fallback"}</span><span className="provider-status">{provider.status}</span></div>)}</div>
    <CloudBackups />
    <button className="button secondary" onClick={onLock}><Icon name="lock" />Lock App</button>
  </section>;
}

export function CloudBackups() {
  // Intentionally memory-only. Leaving Settings or locking the app unmounts this session.
  const [passcode, setPasscode] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [events, setEvents] = useState<BackupEventSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => {
    generation.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  function lock() {
    generation.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPasscode(""); setAuthenticated(false); setEvents([]); setNextCursor(null);
    setBusy(false); setDownloading(null); setMessage(""); setError("");
  }

  function fail(reason: unknown) {
    if (reason instanceof AdminBackupError && reason.status === 401) lock();
    setError(reason instanceof AdminBackupError ? reason.message : "Cloud backups are temporarily unavailable. Please try again.");
  }

  async function load(cursor?: string) {
    if (busy || downloading) return;
    const current = generation.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true); setError(""); setMessage("");
    try {
      const page = await getBackupEvents(passcode, cursor, controller.signal);
      if (generation.current !== current) return;
      setEvents((previous) => cursor ? [...previous, ...page.events.filter((event) => !previous.some((item) => item.eventKey === event.eventKey))] : page.events);
      setNextCursor(page.nextCursor); setAuthenticated(true);
    } catch (reason) {
      if (generation.current === current) fail(reason);
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (generation.current === current) setBusy(false);
    }
  }

  async function download(event: BackupEventSummary) {
    if (busy || downloading) return;
    const current = generation.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setDownloading(event.eventKey); setError(""); setMessage("");
    try {
      await downloadRecoveryCsv(event.eventKey, passcode, {
        signal: controller.signal, isSessionActive: () => generation.current === current,
      });
      if (generation.current === current) setMessage(`Recovery CSV downloaded for ${event.eventName}. Keep this contact file secure.`);
    } catch (reason) {
      if (generation.current === current) fail(reason);
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (generation.current === current) setDownloading(null);
    }
  }

  return <section className="cloud-backups" aria-labelledby="cloud-backups-title">
    <div className="section-title"><h2 id="cloud-backups-title">Cloud Backups</h2>{authenticated && <button className="text-button" onClick={lock}><Icon name="lock" />Lock Backups</button>}</div>
    <p className="muted">Recover approved contact text across team phones, one CSV per event. Photos and raw OCR are never backed up.</p>
    {!authenticated ? <form className="backup-unlock" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label>Administrator Passcode<input type="password" autoComplete="off" value={passcode} onChange={(event) => setPasscode(event.target.value)} aria-invalid={!!error} aria-describedby="backup-session-note" required disabled={busy} /></label>
      <button type="submit" className="button primary" disabled={busy || !passcode.trim()} aria-busy={busy}><Icon name="lock" />{busy ? "Unlocking Backups..." : "Unlock Backups"}</button>
      <p id="backup-session-note" className="backup-note">Separate from the team passcode. Access lasts only while this Settings view is open. Leave Settings to lock.</p>
    </form> : <>
      <p className="backup-note">Administrator access is unlocked. Leave Settings to lock. Backups remain until an administrator deletes them.</p>
      <RecoveryEventList events={events} nextCursor={nextCursor} busy={busy} downloading={downloading} onMore={() => { if (nextCursor) void load(nextCursor); }} onDownload={(event) => { void download(event); }} />
    </>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {message && <p className="message" role="status">{message}</p>}
  </section>;
}

export function RecoveryEventList({ events, nextCursor, busy, downloading, onMore, onDownload }: {
  events: BackupEventSummary[]; nextCursor: string | null; busy: boolean; downloading: string | null;
  onMore(): void; onDownload(event: BackupEventSummary): void;
}) {
  return <div className="recovery-events" aria-busy={busy}>
    {!events.length && <div className="empty-state"><strong>No Cloud Backups Yet</strong><p>Approve a contact while online to create the first event backup. Pending contacts upload when the phone reconnects.</p></div>}
    {events.length > 0 && <ul className="recovery-list">{events.map((event) => <li key={event.eventKey}>
      <div className="recovery-event-summary"><h3>{event.eventName}</h3><dl>
        <div><dt>Event Date</dt><dd><time dateTime={event.eventDate}>{new Date(`${event.eventDate}T12:00:00`).toLocaleDateString()}</time></dd></div>
        <div><dt>Approved Contacts</dt><dd>{event.contactCount.toLocaleString()} {event.contactCount === 1 ? "contact" : "contacts"}</dd></div>
        <div><dt>Latest Backup</dt><dd><time dateTime={new Date(event.lastBackupAt).toISOString()}>{new Date(event.lastBackupAt).toLocaleString()}</time></dd></div>
      </dl></div>
      <button className="button secondary" disabled={busy || downloading !== null} aria-label={`Download recovery CSV for ${event.eventName}, ${event.eventDate}`} aria-busy={downloading === event.eventKey} onClick={() => onDownload(event)}><Icon name="download" />{downloading === event.eventKey ? "Preparing CSV..." : "Download Recovery CSV"}</button>
    </li>)}</ul>}
    {nextCursor && <button className="button secondary" disabled={busy || downloading !== null} onClick={onMore}>{busy ? "Loading Events..." : "Load More Events"}</button>}
  </div>;
}

function friendlyModel(model: string | null) {
  if (!model) return "Waiting for first scan";
  if (model.startsWith("gemini-")) return model.replace("gemini-", "Gemini ").replaceAll("-", " ");
  if (model.includes("gemma")) return "Workers AI · Gemma";
  return model;
}

type CapacityUsage = DeviceUsage | SharedUsage;

function CapacityCard({ usage, onOpen, compact = false }: { usage: CapacityUsage; onOpen(): void; compact?: boolean }) {
  const labels = { healthy: "Healthy", fallback: "Fallback Active", limited: "Limit Reached" };
  const detail = usage.estimatedRemaining !== null
    ? `~${usage.estimatedRemaining} primary requests left`
    : `${usage.scans} scan${usage.scans === 1 ? "" : "s"} ${usage.source === "shared" ? "across the team" : "on this phone"} today`;
  return <button className={`capacity-card capacity-${usage.state} ${compact ? "compact" : ""}`} onClick={onOpen}>
    <span className="capacity-signal" aria-hidden />
    <span><small>AI Capacity</small><strong>{labels[usage.state]}</strong></span>
    <span className="capacity-detail">{detail}<Icon name="chevron" /></span>
  </button>;
}

function UsagePanel({ usage, onClose }: { usage: CapacityUsage; onClose(): void }) {
  const routesAvailable = Math.max(3 - usage.rateLimitedModels.length, 0);
  return <Sheet titleId="usage-title" onClose={onClose} className="usage-sheet">
    <header><div><h2 id="usage-title">AI Capacity</h2><p className="sheet-description">Usage today, {usage.source === "shared" ? "across the team" : "on this phone"}</p></div><button className="close-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
    <div className={`capacity-hero capacity-${usage.state}`}><span className="capacity-signal" /><div><small>Current State</small><strong>{usage.state === "healthy" ? "Healthy" : usage.state === "fallback" ? "Fallback Active" : "A Model Limit Was Reached"}</strong></div></div>
    <div className="usage-metrics">
      <div><strong>{usage.scans}</strong><span>{usage.source === "shared" ? "Team Scans" : "Scans on This Phone"}</span></div>
      <div><strong>{usage.tokens.toLocaleString()}</strong><span>Gemini Tokens Reported</span></div>
      <div><strong>{routesAvailable}/3</strong><span>Gemini Routes Available</span></div>
      <div><strong>{usage.fallbacks}</strong><span>Fallback Events</span></div>
    </div>
    <div className="usage-list">
      <div><span>Active Model</span><strong>{friendlyModel(usage.activeModel)}</strong></div>
      <div><span>Gemini Scans</span><strong>{usage.geminiScans}</strong></div>
      <div><span>Workers AI Scans</span><strong>{usage.cloudflareScans}</strong></div>
      <div><span>Estimated Remaining</span><strong>{usage.estimatedRemaining === null ? "Set in AI Studio" : `~${usage.estimatedRemaining}`}</strong></div>
    </div>
    {usage.rateLimitedModels.length > 0 && <div className="flag-box"><strong>Rate Limit Detected</strong><p>{usage.rateLimitedModels.map(friendlyModel).join(", ")} reached a provider limit today. Automatic routing remains enabled.</p></div>}
    <p className="usage-note">{usage.source === "shared" ? "This privacy-safe counter combines usage across the team without contact details. Approved contact text is stored separately in cloud backups." : "Shared usage is temporarily unavailable, so this view covers this phone only."} Provider dashboards remain the authoritative source for limits.</p>
    <button className="button primary" onClick={onClose}>Done</button>
  </Sheet>;
}

export function CardList({ cards, onSelect, onRetry, onRetryBackup }: { cards: CardRecord[]; onSelect(card: CardRecord): void; onRetry(card: CardRecord): void; onRetryBackup(card: CardRecord): void }) {
  if (!cards.length) return <div className="empty-state"><Icon name="cards" /><strong>No Cards Yet</strong><p>Open the camera to begin.</p></div>;
  return <div className="card-list">{cards.map((card) => <article className={`contact-row state-${card.state}`} key={card.id}>
    <button className="contact-main" onClick={() => card.fields && onSelect(card)} disabled={!card.fields}>
      <Thumb image={card.image} alt="Captured business card" />
      <span className="contact-copy"><span className="row-top"><StatePill state={card.state} />{card.provider && <small>{card.provider}</small>}</span><strong>{card.fields?.firstName || card.fields?.lastName ? `${card.fields.firstName ?? ""} ${card.fields.lastName ?? ""}`.trim() : card.state === "processing" ? "Reading Card…" : "Business Card"}</strong><span className="contact-company">{card.fields?.company ?? card.error ?? card.qualityWarning ?? "Waiting to Be Read"}</span>{card.state === "approved" && card.backupState && <span role="status" className={`backup-status backup-${card.backupState}`}>{card.backupState === "synced" ? "Backed Up" : card.backupState === "failed" ? "Backup Failed" : "Waiting to Back Up"}{card.backupState === "failed" && backupTextIssue(card.fields) && <> - {backupTextIssue(card.fields)}</>}</span>}</span>
    </button>
    {card.state === "error" && <button className="retry-button" onClick={() => onRetry(card)}>Retry</button>}
    {card.state === "approved" && card.backupState === "failed" && <button className="retry-button backup-retry" aria-label={`Retry backup for ${[card.fields?.firstName, card.fields?.lastName].filter(Boolean).join(" ") || "this contact"}`} onClick={() => onRetryBackup(card)}>Retry Backup</button>}
  </article>)}</div>;
}

export function CardEditor({ card, onChange, onClose, onSave }: { card: CardRecord; onChange(card: CardRecord): void; onClose(): void; onSave(approve?: boolean): void }) {
  const fields = card.fields ?? emptyFields;
  const issue = backupTextIssue(fields);
  const update = (field: FieldName, value: string) => onChange({ ...card, fields: { ...fields, [field]: value.trim() || null } });
  return <Sheet titleId="editor-title" onClose={onClose}>
    <header><div><h2 id="editor-title">Card Details</h2><p className="sheet-description">Check against the photo</p></div><button className="close-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
    <div className="editor-image"><Thumb image={card.image} alt="Business card being reviewed" /></div>
    {card.flags?.length ? <div className="flag-box"><strong>Check These Items</strong>{card.flags.filter((flag) => flag.severity === "review").map((flag, index) => <p key={`${flag.code}-${index}`}>{flag.message}</p>)}</div> : !issue && <div className="good-box">All automatic checks passed.</div>}
    {issue && <p className="flag-box" id="backup-field-issue" role="status">{issue}</p>}
    <div className="field-grid">{(Object.keys(fieldLabels) as FieldName[]).map((field) => <label key={field}>{fieldLabels[field]}<input type={field === "email" ? "email" : field === "phone" ? "tel" : "text"} maxLength={CONTACT_FIELD_LIMITS[field]} aria-invalid={(fields[field]?.length ?? 0) > CONTACT_FIELD_LIMITS[field] || undefined} aria-describedby={issue ? "backup-field-issue" : undefined} value={fields[field] ?? ""} onChange={(event) => update(field, event.target.value)} /></label>)}</div>
    <div className="editor-actions"><button className="button secondary" onClick={() => onSave(false)}>Save</button><button className="button primary" onClick={() => onSave(true)}>Approve Contact</button></div>
  </Sheet>;
}
