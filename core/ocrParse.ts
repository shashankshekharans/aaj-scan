// Rule-based fallback: builds an Extraction from plain OCR text when no AI
// provider is available. Deliberately conservative — callers add an
// "ocr_only" flag so every card from this path is reviewed by a person.

import type { Extraction, PhoneType } from "./types";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const WEBSITE = /\b(?:https?:\/\/)?(?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const COMPANY_HINT =
  /\b(pvt|private|ltd|limited|llp|llc|inc|corp|corporation|co\.|company|group|industries|solutions|logistics|technologies|services|enterprises|international|gmbh)\b/i;
const TITLE_HINT =
  /\b(ceo|cto|cfo|coo|founder|director|manager|head|lead|executive|officer|president|vp|vice|engineer|consultant|partner|owner|proprietor|analyst|specialist|associate|coordinator|chairman|md|gm|agm|dgm)\b/i;

function phoneType(line: string): PhoneType {
  const l = line.toLowerCase();
  if (/\b(fax|f)\s*[:.]/.test(l)) return "fax";
  if (/\b(m|mob|mobile|cell|whatsapp)\s*[:.]?/.test(l)) return "mobile";
  if (/\b(t|tel|ph|phone|off|office|board)\s*[:.]?/.test(l)) return "office";
  return "unknown";
}

export function parseOcrText(text: string): Extraction {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const emails = [...new Set(text.match(EMAIL) ?? [])];
  const website = text.match(WEBSITE)?.[0] ?? null;

  const phones: Extraction["phones"] = [];
  for (const line of lines) {
    for (const m of line.match(PHONE) ?? []) {
      if (m.replace(/\D/g, "").length >= 8) phones.push({ number: m.trim(), type: phoneType(line) });
    }
  }

  // Non-global copy: RegExp.test with the /g flag keeps state between calls.
  const hasEmail = new RegExp(EMAIL.source, "i");
  const isContactLine = (l: string) => hasEmail.test(l) || /\d{5,}/.test(l.replace(/\s/g, "")) || WEBSITE.test(l);
  const textLines = lines.filter((l) => !isContactLine(l));

  const company = textLines.find((l) => COMPANY_HINT.test(l)) ?? null;
  const job_title = textLines.find((l) => l !== company && TITLE_HINT.test(l)) ?? null;
  // Name: first short line of 2–4 alphabetic words that is not the company or title.
  const name =
    textLines.find(
      (l) => l !== company && l !== job_title && /^[A-Za-z][A-Za-z.' -]+$/.test(l) && l.split(/\s+/).length <= 4 && l.split(/\s+/).length >= 2,
    ) ?? null;
  const parts = name?.split(/\s+/) ?? [];

  return {
    is_business_card: true,
    language: "en",
    full_name: name,
    first_name: parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? null),
    last_name: parts.length > 1 ? parts[parts.length - 1]! : null,
    job_title,
    company,
    emails,
    phones,
    website,
  };
}
