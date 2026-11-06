// HubSpot contact CSV, shared by the phone export and the administrator
// recovery download so both files are identical in shape and escaping.

import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export interface CsvContact {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  jobTitle: string | null;
  phone: string | null;
  eventName: string;
}

const COLUMNS = ["First Name", "Last Name", "Company Name", "Email", "Job Title", "Phone Number", "Event Name"];

/** Only digits, spaces and phone punctuation: nothing a spreadsheet can execute. */
const PLAIN_PHONE = /^\+?[0-9 ().-]+$/;

/**
 * HubSpot reads international numbers best as "+<country code><number>".
 * A number printed with a country code is converted to that form; one printed
 * without stays as printed, because the country is never guessed.
 */
export function formatPhoneForHubSpot(value: string | null): string {
  const text = value?.trim() ?? "";
  if (!text) return "";
  const parsed = text.startsWith("+") ? parsePhoneNumberFromString(text) : undefined;
  return parsed?.isValid() ? parsed.number : text;
}

/** Quotes a cell and neutralises text a spreadsheet would treat as a formula. */
function cell(value: string | null, isPhone = false): string {
  const text = value ?? "";
  const formulaLike = /^[=+\-@\t\r]/.test(text) && !(isPhone && PLAIN_PHONE.test(text));
  return `"${(formulaLike ? `'${text}` : text).replace(/"/g, '""')}"`;
}

/** UTF-8 text with no byte-order mark: importers that ignore one show it as garbage in the first header. */
export function contactsCsv(contacts: CsvContact[]): string {
  const rows = contacts.map((c) =>
    [cell(c.firstName), cell(c.lastName), cell(c.company), cell(c.email), cell(c.jobTitle), cell(formatPhoneForHubSpot(c.phone), true), cell(c.eventName)].join(","),
  );
  return [COLUMNS.map((column) => cell(column)).join(","), ...rows].join("\r\n");
}

export function csvFilename(eventName: string): string {
  return `${eventName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "contacts"}.csv`;
}
