import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardList, CardEditor, CloudBackups, RecoveryEventList, SocialFooter, providerStatusTone } from "./App";
import type { CardRecord } from "./db";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: vi.fn(actual.useState), useRef: vi.fn(actual.useRef),
    useEffect: vi.fn(actual.useEffect), useLayoutEffect: vi.fn(actual.useLayoutEffect) };
});

const contact: CardRecord = { id: "card", batchId: "event", createdAt: 1, image: new Blob(), state: "approved",
  fields: { firstName: "Ada", lastName: "Lovelace", company: "Synthetic", email: null, jobTitle: null, phone: null } };
const render = (card: CardRecord) => renderToStaticMarkup(<CardList cards={[card]} onSelect={() => {}} onRetry={() => {}} onRetryBackup={() => {}} />);

describe("social footer", () => {
  it("links to the three requested profiles with accessible labels", () => {
    const html = renderToStaticMarkup(<SocialFooter />);
    expect(html).toContain('aria-label="GitHub profile"');
    expect(html).toContain('href="https://github.com/shashankshekharans"');
    expect(html).toContain('aria-label="Instagram profile"');
    expect(html).toContain('href="https://www.instagram.com/shashankshekharans/"');
    expect(html).toContain('aria-label="X profile"');
    expect(html).toContain('href="https://x.com/SHASHANK_ANS"');
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
  });
});

describe("semantic provider status colours", () => {
  it.each(["active", "ready", "healthy", "success", "preview"])("maps %s to healthy", (status) => {
    expect(providerStatusTone(status)).toBe("healthy");
  });

  it.each(["fallback", "degraded", "rate_limited", "limited", "quota_exhausted", "unexpected"])("maps %s to warning", (status) => {
    expect(providerStatusTone(status)).toBe("warning");
  });

  it.each(["error", "failed", "unavailable", "missing", "inactive", "disabled"])("maps %s to error", (status) => {
    expect(providerStatusTone(status)).toBe("error");
  });
});

describe("approved-contact backup status", () => {
  it.each([["pending", "Waiting to Back Up"], ["synced", "Backed Up"], ["failed", "Backup Failed"]] as const)("shows %s status without technical errors", (backupState, label) => {
    const html = render({ ...contact, backupState, backupError: "private SQL or email" });
    expect(html).toContain(label);
    expect(html).not.toContain("private SQL or email");
  });

  it("offers a separate, named retry action only for failed approved backups", () => {
    const failed = render({ ...contact, backupState: "failed" });
    expect(failed).toContain('aria-label="Retry backup for Ada Lovelace"');
    expect(failed).toContain("Retry Backup");
    expect(render({ ...contact, backupState: "pending" })).not.toContain("Retry Backup");
    expect(render({ ...contact, state: "needs_review", backupState: "failed" })).not.toContain("Backup Failed");
    expect(render({ ...contact, state: "needs_review", backupState: "failed" })).not.toContain("Retry Backup");
  });

  it("does not imply that historical approved cards are uploaded or queued", () => {
    const html = render(contact);
    expect(html).toContain("Approved");
    expect(html).not.toContain("Backed Up");
    expect(html).not.toContain("Waiting to Back Up");
    expect(html).not.toContain("Backup Failed");
  });
});


describe("cloud backup recovery", () => {
  it("requires a separate administrator unlock and explains session-only access", () => {
    const html = renderToStaticMarkup(<CloudBackups />);
    expect(html).toContain("Cloud Backups");
    expect(html).toContain("Administrator Passcode");
    expect(html).toContain('type="password"');
    expect(html).toContain("Unlock Backups");
    expect(html).toContain("Leave Settings to lock");
    expect(html).not.toContain("Download Recovery CSV");
  });

  it("renders event summaries and pagination without individual contact data", () => {
    const event = { eventKey: "a".repeat(64), eventName: "Synthetic fair", eventDate: "2026-11-02", contactCount: 2, lastBackupAt: 1793577600000, email: "private@example.com", firstName: "Private person" };
    const html = renderToStaticMarkup(<RecoveryEventList events={[event]} nextCursor={"b".repeat(64)} busy={false} downloading={null} onMore={() => {}} onDownload={() => {}} />);
    expect(html).toContain("Synthetic fair");
    expect(html.toLowerCase()).toContain('datetime="2026-11-02"');
    expect(html).toContain("2 contacts");
    expect(html).toContain("Latest Backup");
    expect(html).toContain("Download Recovery CSV");
    expect(html).toContain("Load More Events");
    expect(html).not.toContain("private@example.com");
    expect(html).not.toContain("Private person");
  });

  it("explains the empty state and removes pagination at the end", () => {
    const html = renderToStaticMarkup(<RecoveryEventList events={[]} nextCursor={null} busy={false} downloading={null} onMore={() => {}} onDownload={() => {}} />);
    expect(html).toContain("No Cloud Backups Yet");
    expect(html).toContain("Approve a contact");
    expect(html).not.toContain("Load More Events");
  });

  it("disables duplicate actions while loading or downloading", () => {
    const event = { eventKey: "a".repeat(64), eventName: "Synthetic fair", eventDate: "2026-11-02", contactCount: 2, lastBackupAt: 1793577600000 };
    const html = renderToStaticMarkup(<RecoveryEventList events={[event]} nextCursor={"b".repeat(64)} busy={true} downloading={event.eventKey} onMore={() => {}} onDownload={() => {}} />);
    expect(html).toContain("Preparing CSV");
    expect(html).toContain("Loading Events");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});


// Drive this component's event/effect boundaries without requiring a browser DOM.
// Requests, cancellation, body reads and download activation remain real production code.
function mountCloudBackups() {
  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let mounted = false;
  let cleanup: (() => void) | undefined;
  vi.spyOn(React, "useState").mockImplementation(((initial: unknown) => {
    const index = stateIndex++;
    if (!(index in state)) state[index] = initial;
    return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
  }) as typeof React.useState);
  vi.spyOn(React, "useRef").mockImplementation(((initial: unknown) => {
    const index = refIndex++;
    return refs[index] ??= { current: initial };
  }) as typeof React.useRef);
  const effect = (setup: () => void | (() => void)) => { if (!mounted) cleanup = setup() || undefined; };
  vi.spyOn(React, "useEffect").mockImplementation(effect);
  vi.spyOn(React, "useLayoutEffect").mockImplementation(effect);
  return {
    render() { stateIndex = 0; refIndex = 0; const view = CloudBackups(); mounted = true; return view; },
    unmount() { cleanup?.(); },
  };
}

function findElement(node: React.ReactNode, predicate: (element: React.ReactElement<Record<string, any>>) => boolean): React.ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map((item) => findElement(item, predicate)).find(Boolean);
  if (!React.isValidElement<Record<string, any>>(node)) return undefined;
  return predicate(node) ? node : findElement(node.props.children, predicate);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ending a recovery session during download", () => {
  it.each(["lock", "unmount"] as const)("prevents saving a delayed CSV after %s and aborts the body read", async (endSession) => {
    let signal: AbortSignal | null | undefined;
    let finish!: (blob: Blob) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    const response = new Response("unused", { headers: { "content-type": "text/csv" } });
    vi.spyOn(response, "blob").mockImplementation(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      if (path.endsWith(".csv")) { signal = init.signal; return response; }
      return Response.json({ events: [{ eventKey: "a".repeat(64), eventName: "Synthetic fair", eventDate: "2026-11-02", contactCount: 1, lastBackupAt: 1793577600000 }], nextCursor: null });
    });
    const click = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ href: "", download: "", click }) });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:late", revokeObjectURL: () => {} });
    const session = mountCloudBackups();
    let view = session.render();
    findElement(view, (element) => element.type === "input")!.props.onChange({ target: { value: "admin" } });
    view = session.render();
    findElement(view, (element) => element.type === "form")!.props.onSubmit({ preventDefault() {} });
    await vi.waitFor(() => { view = session.render(); expect(findElement(view, (element) => element.type === RecoveryEventList)).toBeDefined(); });
    const list = findElement(view, (element) => element.type === RecoveryEventList)!;
    list.props.onDownload(list.props.events[0]);
    await reading;
    view = session.render();
    if (endSession === "lock") findElement(view, (element) => element.type === "button" && React.Children.toArray(element.props.children).includes("Lock Backups"))!.props.onClick();
    else session.unmount();
    // Even a body adapter which ignores cancellation must never activate a link.
    finish(new Blob(["late private CSV"]));
    await vi.waitFor(() => { expect(signal?.aborted).toBe(true); });
    await Promise.resolve();
    expect(click).not.toHaveBeenCalled();
  });
});


describe("backup field limits", () => {
  it("bounds editable fields and explains oversized extraction without disabling local save or approval", () => {
    const oversized = { ...contact, fields: { ...contact.fields!, company: "a".repeat(301) } };
    const html = renderToStaticMarkup(<CardEditor card={oversized} onChange={() => {}} onClose={() => {}} onSave={() => {}} />);
    expect(html.match(/maxLength="(\d+)"/g)).toEqual(['maxLength="200"', 'maxLength="200"', 'maxLength="300"', 'maxLength="320"', 'maxLength="300"', 'maxLength="100"']);
    expect(html).toContain("Shorten company to 300 characters");
    expect(html).toContain("CSV export still work");
    expect(html).not.toContain("All automatic checks passed");
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain('disabled=""');
  });
});
