import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCard } from "../core/postprocess";
import type { ContactFields, FieldName } from "../core/types";
import { checkPasscode, extractCard } from "./api";
import { downloadCsv } from "./csv";
import { db, type BatchRecord, type CardRecord, type CardState } from "./db";
import { prepareImage, runCombinedOcr } from "./image";

const emptyFields: ContactFields = { firstName: null, lastName: null, company: null, email: null, jobTitle: null, phone: null };
const fieldLabels: Record<FieldName, string> = {
  firstName: "First name", lastName: "Last name", company: "Company", email: "Work email", jobTitle: "Job title", phone: "Phone",
};

function Thumb({ image, alt }: { image: Blob; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);
  return <img className="card-thumb" src={url} alt={alt} />;
}

function StatePill({ state }: { state: CardState }) {
  const label: Record<CardState, string> = {
    queued: "Queued", processing: "Reading", looks_good: "Looks good", needs_review: "Check", skipped: "Skipped", approved: "Approved", error: "Retry",
  };
  return <span className={`pill pill-${state}`}>{label[state]}</span>;
}

export default function App() {
  const [passcode, setPasscode] = useState(() => sessionStorage.getItem("contact-scan-passcode") ?? "");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState("");
  const [providers, setProviders] = useState<{ id: string; status: string }[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [eventName, setEventName] = useState("");
  const [selected, setSelected] = useState<CardRecord | null>(null);
  const [message, setMessage] = useState("");
  const [screen, setScreen] = useState<"scan" | "review" | "settings">("scan");
  const processing = useRef(false);

  const refreshBatches = useCallback(async () => setBatches(await db.batches.orderBy("createdAt").reverse().toArray()), []);
  const refreshCards = useCallback(async () => {
    if (!batch) return setCards([]);
    setCards(await db.cards.where("batchId").equals(batch.id).sortBy("createdAt"));
  }, [batch]);

  useEffect(() => { void refreshBatches(); }, [refreshBatches]);
  useEffect(() => { void refreshCards(); }, [refreshCards]);

  const unlock = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setAuthError("");
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
      setAuthError(error instanceof Error ? error.message : "Could not unlock");
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
      }
    } finally {
      await wakeLock?.release();
      processing.current = false;
      await refreshCards();
    }
  }, [batch, passcode, refreshCards]);

  useEffect(() => {
    const resume = () => void processQueue();
    window.addEventListener("online", resume);
    void processQueue();
    return () => window.removeEventListener("online", resume);
  }, [processQueue]);

  const createBatch = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = eventName.trim();
    if (!name) return;
    const next = { id: crypto.randomUUID(), eventName: name, createdAt: Date.now() };
    await db.batches.add(next);
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
    await Promise.all(clean.map((card) => db.cards.update(card.id, { state: "approved" })));
    await refreshCards();
  };

  const saveSelected = async (approve = false) => {
    if (!selected) return;
    const next = { ...selected, state: approve ? "approved" as const : selected.state };
    await db.cards.put(next);
    setSelected(null);
    await refreshCards();
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

  if (!unlocked) {
    return <main className="lock-shell">
      <section className="lock-card">
        <div className="brand-lockup"><span>AAJ</span><small>Optimizing supply chains</small></div>
        <p className="eyebrow">Marketing operations</p>
        <h1>Contact Scan</h1>
        <p className="lede">Turn a stack of business cards into a checked, HubSpot-ready file.</p>
        <form onSubmit={unlock}>
          <label>Team passcode<input type="password" autoComplete="current-password" value={passcode} onChange={(event) => setPasscode(event.target.value)} required /></label>
          {authError && <p className="error-text">{authError}</p>}
          <button className="button primary" type="submit">Unlock scanner</button>
        </form>
        <p className="privacy-note">Photos are processed temporarily and stay on this phone until you clear the batch.</p>
      </section>
    </main>;
  }

  if (!batch) {
    return <main className="app-shell">
      <header className="topbar"><div><span className="brand-small">AAJ</span><strong>Contact Scan</strong></div><span className={`network ${navigator.onLine ? "online" : "offline"}`}>{navigator.onLine ? "Online" : "Offline"}</span></header>
      <section className="home-hero">
        <p className="eyebrow">Ready for the next stack</p><h1>Start with the event.</h1>
        <p>Every approved contact will carry this event name into HubSpot.</p>
        <form className="event-form" onSubmit={createBatch}>
          <label>Event name<input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="e.g. India Warehousing Show 2026" required /></label>
          <button className="button primary" type="submit">Start batch</button>
        </form>
      </section>
      {batches.length > 0 && <section className="section"><div className="section-title"><h2>Continue a batch</h2><span>{batches.length} on this phone</span></div>
        <div className="batch-list">{batches.map((item) => <button className="batch-item" key={item.id} onClick={() => setBatch(item)}><span><strong>{item.eventName}</strong><small>{new Date(item.createdAt).toLocaleDateString()}</small></span><span aria-hidden>→</span></button>)}</div>
      </section>}
    </main>;
  }

  return <main className="app-shell with-nav">
    <header className="topbar"><button className="back-button" onClick={() => setBatch(null)}>←</button><div className="batch-heading"><strong>{batch.eventName}</strong><small>{cards.length} cards on this phone</small></div><span className={`network ${navigator.onLine ? "online" : "offline"}`}>{navigator.onLine ? "Online" : "Offline"}</span></header>

    {screen === "scan" && <>
      <section className="scan-hero">
        <p className="eyebrow">Capture</p><h1>Keep the card inside the frame.</h1>
        <p>Use bright, even light. One card per photo.</p>
        <div className="capture-actions">
          <label className="button primary camera-button">Open camera<input hidden type="file" accept="image/*" capture="environment" onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} /></label>
          <label className="button secondary">Choose photos<input hidden type="file" accept="image/*" multiple onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} /></label>
        </div>
        {message && <p className="message">{message}</p>}
      </section>
      <section className="stats-grid"><div><strong>{cards.length}</strong><span>Captured</span></div><div><strong>{counts.pending}</strong><span>Processing</span></div><div><strong>{counts.review}</strong><span>Need checking</span></div></section>
      {cards.length > 0 && <section className="section"><div className="section-title"><h2>Latest cards</h2><button className="text-button" onClick={() => setScreen("review")}>Review all →</button></div><CardList cards={cards.slice(-4).reverse()} onSelect={setSelected} onRetry={retry} /></section>}
    </>}

    {screen === "review" && <section className="section review-section">
      <div className="section-title"><div><p className="eyebrow">Review</p><h1>{counts.approved} approved</h1></div>{counts.clean > 0 && <button className="button compact" onClick={approveClean}>Approve {counts.clean} clean</button>}</div>
      <div className="review-summary"><span><i className="dot green" />{counts.clean} look good</span><span><i className="dot amber" />{counts.review} check</span><span><i className="dot dark" />{counts.approved} approved</span></div>
      <CardList cards={cards} onSelect={setSelected} onRetry={retry} />
      <div className="export-panel"><div><strong>HubSpot export</strong><span>{counts.approved} approved contacts</span></div><button className="button primary" disabled={!counts.approved} onClick={() => downloadCsv(batch, cards)}>Download CSV</button></div>
      <button className="danger-button" onClick={clearBatch}>File saved? Clear this batch</button>
    </section>}

    {screen === "settings" && <section className="section settings-section"><p className="eyebrow">Settings</p><h1>Provider status</h1><p className="muted">Keys are encrypted in the Cloudflare Worker and are never sent to this phone.</p>
      <div className="provider-list">{providers.map((provider, index) => <div key={provider.id}><span><i className="status-light" /><strong>{provider.id === "gemini" ? "Gemini" : "Cloudflare Workers AI"}</strong></span><span>{index === 0 ? "Primary" : "Fallback"}</span></div>)}</div>
      <button className="button secondary" onClick={() => { sessionStorage.removeItem("contact-scan-passcode"); setUnlocked(false); setPasscode(""); }}>Lock app</button>
    </section>}

    <nav className="bottom-nav"><button className={screen === "scan" ? "active" : ""} onClick={() => setScreen("scan")}><span>＋</span>Scan</button><button className={screen === "review" ? "active" : ""} onClick={() => setScreen("review")}><span>✓</span>Review</button><button className={screen === "settings" ? "active" : ""} onClick={() => setScreen("settings")}><span>•••</span>Settings</button></nav>

    {selected && <CardEditor card={selected} onChange={setSelected} onClose={() => setSelected(null)} onSave={saveSelected} />}
  </main>;
}

function CardList({ cards, onSelect, onRetry }: { cards: CardRecord[]; onSelect(card: CardRecord): void; onRetry(card: CardRecord): void }) {
  if (!cards.length) return <div className="empty-state">No cards yet. Open the camera to begin.</div>;
  return <div className="card-list">{cards.map((card) => <article className="contact-row" key={card.id}>
    <button className="contact-main" onClick={() => card.fields && onSelect(card)} disabled={!card.fields}>
      <Thumb image={card.image} alt="Captured business card" />
      <span className="contact-copy"><span className="row-top"><StatePill state={card.state} />{card.provider && <small>{card.provider}</small>}</span><strong>{card.fields?.firstName || card.fields?.lastName ? `${card.fields.firstName ?? ""} ${card.fields.lastName ?? ""}`.trim() : card.state === "processing" ? "Reading card…" : "Business card"}</strong><span>{card.fields?.company ?? card.error ?? card.qualityWarning ?? "Waiting to be read"}</span></span>
    </button>
    {card.state === "error" && <button className="retry-button" onClick={() => onRetry(card)}>Retry</button>}
  </article>)}</div>;
}

function CardEditor({ card, onChange, onClose, onSave }: { card: CardRecord; onChange(card: CardRecord): void; onClose(): void; onSave(approve?: boolean): void }) {
  const fields = card.fields ?? emptyFields;
  const update = (field: FieldName, value: string) => onChange({ ...card, fields: { ...fields, [field]: value.trim() || null } });
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="editor-sheet">
    <header><div><p className="eyebrow">Card details</p><h2>Check against the photo</h2></div><button className="close-button" onClick={onClose} aria-label="Close">×</button></header>
    <div className="editor-image"><Thumb image={card.image} alt="Business card being reviewed" /></div>
    {card.flags?.length ? <div className="flag-box"><strong>Check these items</strong>{card.flags.filter((flag) => flag.severity === "review").map((flag, index) => <p key={`${flag.code}-${index}`}>{flag.message}</p>)}</div> : <div className="good-box">All automatic checks passed.</div>}
    <div className="field-grid">{(Object.keys(fieldLabels) as FieldName[]).map((field) => <label key={field}>{fieldLabels[field]}<input type={field === "email" ? "email" : "text"} value={fields[field] ?? ""} onChange={(event) => update(field, event.target.value)} /></label>)}</div>
    <div className="editor-actions"><button className="button secondary" onClick={() => onSave(false)}>Save</button><button className="button primary" onClick={() => onSave(true)}>Approve contact</button></div>
  </section></div>;
}
