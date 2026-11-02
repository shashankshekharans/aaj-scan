import type { BatchRecord, CardRecord } from "./db";

const columns = ["First Name", "Last Name", "Company Name", "Email", "Job Title", "Phone Number", "Event Name"];
const escape = (value: string | null | undefined) => {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function createCsvExport(batch: BatchRecord, cards: CardRecord[]) {
  const rows = cards.filter((card) => card.state === "approved" && card.fields).map((card) => {
    const f = card.fields!;
    return [f.firstName, f.lastName, f.company, f.email, f.jobTitle, f.phone, batch.eventName].map(escape).join(",");
  });
  const content = `\uFEFF${columns.map(escape).join(",")}\r\n${rows.join("\r\n")}`;
  const filename = `${batch.eventName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "contacts"}.csv`;
  return { content, filename };
}

export function downloadCsv(batch: BatchRecord, cards: CardRecord[]) {
  const { content, filename } = createCsvExport(batch, cards);
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface ShareAdapters {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download: typeof downloadCsv;
  openMail: (url: string) => void;
}

export async function shareCsv(
  batch: BatchRecord,
  cards: CardRecord[],
  adapters: ShareAdapters = {
    canShare: navigator.canShare?.bind(navigator),
    share: navigator.share?.bind(navigator),
    download: downloadCsv,
    openMail: (url) => { window.location.href = url; },
  },
): Promise<"shared" | "mail" | "cancelled"> {
  const { content, filename } = createCsvExport(batch, cards);
  const files = [new File([content], filename, { type: "text/csv" })];
  const title = `Marketing Contacts from ${batch.eventName}`;
  if (adapters.canShare?.({ files }) && adapters.share) {
    try {
      await adapters.share({ files, title, text: `Please find the approved marketing contacts collected at ${batch.eventName}.` });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }
  adapters.download(batch, cards);
  const body = `Please find the approved marketing contacts collected at ${batch.eventName}. The CSV has been downloaded and should be attached to this email.`;
  adapters.openMail(`mailto:info@aajscm.com?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`);
  return "mail";
}
