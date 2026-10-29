// Validates and normalises a model's JSON answer into an Extraction.
// Models sometimes wrap JSON in code fences or omit fields; anything that does
// not fit the schema becomes null/empty rather than being guessed.

import type { Extraction, PhoneType } from "./types";

const PHONE_TYPES: PhoneType[] = ["mobile", "office", "fax", "unknown"];

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseExtraction(raw: string): Extraction {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model response contained no JSON object");
  const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const phones = Array.isArray(o.phones) ? o.phones : [];
  return {
    is_business_card: o.is_business_card !== false,
    language: str(o.language)?.toLowerCase() ?? "en",
    full_name: str(o.full_name),
    first_name: str(o.first_name),
    last_name: str(o.last_name),
    job_title: str(o.job_title),
    company: str(o.company),
    emails: (Array.isArray(o.emails) ? o.emails : []).map(str).filter((x): x is string => !!x),
    phones: phones
      .map((p) => {
        const r = (p ?? {}) as Record<string, unknown>;
        const number = str(r.number);
        const type = PHONE_TYPES.includes(r.type as PhoneType) ? (r.type as PhoneType) : "unknown";
        return number ? { number, type } : null;
      })
      .filter((x): x is { number: string; type: PhoneType } => !!x),
    website: str(o.website),
  };
}
