import type { BatchRecord, CardRecord } from "./db";

const columns = ["First Name", "Last Name", "Company Name", "Email", "Job Title", "Phone Number", "Event Name"];
const escape = (value: string | null | undefined) => `"${(value ?? "").replace(/"/g, '""')}"`;

export function downloadCsv(batch: BatchRecord, cards: CardRecord[]) {
  const rows = cards.filter((card) => card.state === "approved" && card.fields).map((card) => {
    const f = card.fields!;
    return [f.firstName, f.lastName, f.company, f.email, f.jobTitle, f.phone, batch.eventName].map(escape).join(",");
  });
  const content = `\uFEFF${columns.map(escape).join(",")}\r\n${rows.join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${batch.eventName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "contacts"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
