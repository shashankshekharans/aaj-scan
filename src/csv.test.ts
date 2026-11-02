import { describe, expect, it, vi } from "vitest";
import { createCsvExport, shareCsv } from "./csv";
import type { BatchRecord, CardRecord } from "./db";

const batch: BatchRecord = { id: "event", eventName: "Trade Fair / 2026!", createdAt: 1 };
const contact: CardRecord = {
  id: "card", batchId: "event", createdAt: 1, image: new Blob(), state: "approved",
  fields: { firstName: "Ada", lastName: "Lovelace", company: 'ACME, "India"', email: "ada@example.com", jobTitle: null, phone: "+919876543210" },
};

describe("createCsvExport", () => {
  it("exports only approved contacts with fields in the seven HubSpot columns", () => {
    const result = createCsvExport(batch, [contact, { ...contact, state: "needs_review" }, { ...contact, fields: undefined }]);
    expect(result).toEqual({ filename: "trade-fair-2026.csv", content: '\uFEFF"First Name","Last Name","Company Name","Email","Job Title","Phone Number","Event Name"\r\n"Ada","Lovelace","ACME, ""India""","ada@example.com","","\'+919876543210","Trade Fair / 2026!"' });
  });

  it("uses a safe default filename when the event has no filename characters", () => {
    expect(createCsvExport({ ...batch, eventName: "///" }, []).filename).toBe("contacts.csv");
  });

  it.each(["=SUM(1,2)", "+123", "-123", "@formula", "\tformula", "\rformula"])("neutralizes leading spreadsheet controls in all exported fields: %j", (value) => {
    const fields = { firstName: value, lastName: value, company: value, email: value, jobTitle: value, phone: value };
    const row = createCsvExport({ ...batch, eventName: value }, [{ ...contact, fields }]).content.split("\r\n")[1];
    expect(row).toBe(Array(7).fill(`"'${value}"`).join(","));
  });
});

function adapters() {
  return { canShare: vi.fn((_data: ShareData) => false), share: vi.fn(async (_data: ShareData) => {}), download: vi.fn(), openMail: vi.fn((_url: string) => {}) };
}

describe("shareCsv", () => {
  it("shares one CSV file only when file sharing is supported", async () => {
    const browser = adapters();
    browser.canShare.mockReturnValue(true);
    expect(await shareCsv(batch, [contact], browser)).toBe("shared");
    const data = browser.share.mock.calls[0]![0];
    expect(data.title).toBe("Marketing Contacts from Trade Fair / 2026!");
    expect(data.files).toHaveLength(1);
    expect(data.files![0]!.name).toBe("trade-fair-2026.csv");
    expect(data.files![0]!.type).toBe("text/csv");
    expect(new Uint8Array(await data.files![0]!.arrayBuffer())).toEqual(new TextEncoder().encode(createCsvExport(batch, [contact]).content));
    expect(browser.canShare).toHaveBeenCalledWith({ files: data.files });
    expect(browser.download).not.toHaveBeenCalled();
    expect(browser.openMail).not.toHaveBeenCalled();
  });

  it("downloads before opening a pre-addressed event email when file sharing is unsupported", async () => {
    const browser = adapters();
    expect(await shareCsv(batch, [contact], browser)).toBe("mail");
    expect(browser.download).toHaveBeenCalledWith(batch, [contact]);
    const mail = new URL(browser.openMail.mock.calls[0]![0]);
    expect(mail.pathname).toBe("info@aajscm.com");
    expect(mail.searchParams.get("subject")).toBe("Marketing Contacts from Trade Fair / 2026!");
    expect(mail.searchParams.get("body")).toBe("Please find the approved marketing contacts collected at Trade Fair / 2026!. The CSV has been downloaded and should be attached to this email.");
    expect(browser.download.mock.invocationCallOrder[0]).toBeLessThan(browser.openMail.mock.invocationCallOrder[0]!);
    expect(browser.share).not.toHaveBeenCalled();
  });

  it("does not infer file support from the share method alone", async () => {
    const browser = adapters();
    expect(await shareCsv(batch, [contact], { ...browser, canShare: undefined })).toBe("mail");
    expect(browser.share).not.toHaveBeenCalled();
  });

  it("treats native cancellation quietly without downloading or opening mail", async () => {
    const browser = adapters();
    browser.canShare.mockReturnValue(true);
    browser.share.mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    expect(await shareCsv(batch, [contact], browser)).toBe("cancelled");
    expect(browser.download).not.toHaveBeenCalled();
    expect(browser.openMail).not.toHaveBeenCalled();
  });

  it("propagates other native failures without silently downloading", async () => {
    const browser = adapters();
    browser.canShare.mockReturnValue(true);
    browser.share.mockRejectedValue(new Error("Share unavailable"));
    await expect(shareCsv(batch, [contact], browser)).rejects.toThrow("Share unavailable");
    expect(browser.download).not.toHaveBeenCalled();
    expect(browser.openMail).not.toHaveBeenCalled();
  });
});
