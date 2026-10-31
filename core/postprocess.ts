// Turns a model Extraction into an exportable contact plus review flags.
// Deterministic fallbacks are allowed only when their source is on the card
// and the resulting field is explicitly flagged for human review.

import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { isOnCard } from "./grounding";
import {
  ALL_FIELDS,
  REQUIRED_FIELDS,
  type CardResult,
  type CardStatus,
  type ContactFields,
  type Extraction,
  type FieldName,
  type Flag,
} from "./types";

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com",
  "rediffmail.com", "protonmail.com", "proton.me",
]);

const HONORIFIC = /^(dr|mr|mrs|ms|miss|prof|er|shri|smt|sri)\.?\s+/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const clean = (s: string | null | undefined) => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t : null;
};

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function hostOf(website: string | null): string | null {
  if (!website) return null;
  const h = website.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return h || null;
}

const domainOf = (email: string) => email.toLowerCase().split("@")[1] ?? "";

function companyFromEmail(email: string | null): string | null {
  if (!email || !EMAIL_RE.test(email)) return null;
  const domain = domainOf(email);
  if (PERSONAL_DOMAINS.has(domain)) return null;
  const label = domain.split(".")[0]?.trim();
  if (!label || label.length < 2) return null;
  const company = label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
  return company || null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function flagCompanyFromEmail(company: string | null, email: string | null, e: Extraction, ocrText: string | null, flags: Flag[]) {
  const domainCompany = companyFromEmail(email);
  if (!company || !domainCompany || alnum(company) !== alnum(domainCompany)) return;
  if (ocrText) {
    const nonCompanySources = [...e.emails, e.website].filter((v): v is string => !!v);
    const independentText = nonCompanySources.reduce(
      (text, value) => text.replace(new RegExp(escapeRegExp(value), "gi"), " "),
      ocrText,
    );
    if (isOnCard(company, independentText, "text")) return;
  }
  flags.push({
    code: "company_from_email",
    field: "company",
    severity: "review",
    message: `Company matches the email domain (${domainOf(email!)}) — confirm the name`,
  });
}

function sameSite(a: string, b: string) {
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) return oneEditApart(b, a);
  let edits = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (++edits > 1) {
      return false;
    } else if (a.length === b.length) {
      i++;
      j++;
    } else {
      j++;
    }
  }
  return edits === 1;
}

const GENERIC_WORDS = new Set(["private", "limited", "india", "group", "company", "corporation", "industries", "solutions", "technologies", "services", "enterprises", "international", "trading", "home", "homes"]);

/**
 * Does the email domain resemble the company name? Either the domain label is
 * inside the name ("brightcook" in "Brightcook Home Appliances") or a
 * distinctive word of the name is inside the label ("zephyr" in "zephyrwatch").
 */
function domainMatchesCompany(domain: string, company: string | null) {
  if (!company) return false;
  const label = domain.split(".")[0] ?? "";
  if (label.length >= 3 && alnum(company).includes(label)) return true;
  return company
    .split(/\s+/)
    .map(alnum)
    .some((w) => w.length >= 4 && !GENERIC_WORDS.has(w) && label.includes(w));
}

function pickEmail(e: Extraction, company: string | null, site: string | null, flags: Flag[]): string | null {
  const emails = e.emails.map((x) => clean(x)?.toLowerCase().replace(/\s/g, "")).filter((x): x is string => !!x);
  if (emails.length === 0) return null;

  let chosen = emails[0]!;
  if (emails.length > 1) {
    const matching = emails.filter((m) => (site && sameSite(domainOf(m), site)) || domainMatchesCompany(domainOf(m), company));
    const pool = matching.length ? matching : emails;
    const nameParts = [e.first_name, e.last_name].map((n) => alnum(n ?? "")).filter((n) => n.length >= 3);
    chosen = pool.find((m) => nameParts.some((n) => m.split("@")[0]!.includes(n))) ?? pool[0]!;
    flags.push({ code: "multiple_emails", field: "email", severity: "review", message: `${emails.length} emails on card — confirm the right one` });
  }

  if (!EMAIL_RE.test(chosen)) {
    flags.push({ code: "invalid_email", field: "email", severity: "review", message: "Email format looks wrong" });
    return chosen;
  }

  const domain = domainOf(chosen);
  if (PERSONAL_DOMAINS.has(domain)) {
    flags.push({ code: "personal_email", field: "email", severity: "info", message: "Personal email address" });
  } else if (site && sameSite(domain, site)) {
    // Consistent with the card.
  } else if (site && oneEditApart(domain, site)) {
    flags.push({ code: "email_domain_mismatch", field: "email", severity: "review", message: `Email domain is one character different from the website (${site}) — check for a typo` });
  } else if (domainMatchesCompany(domain, company)) {
    // A distinct company-related domain may legitimately differ from the website.
  } else if (site) {
    flags.push({ code: "email_domain_mismatch", field: "email", severity: "review", message: `Email domain differs from website (${site}) and company name` });
  } else if (company) {
    flags.push({ code: "email_domain_mismatch", field: "email", severity: "review", message: "Email domain does not resemble the company name — check the address" });
  }
  return chosen;
}

function titleMayBeTruncated(title: string, ocrText: string): boolean {
  const titlePattern = escapeRegExp(title).replace(/\\\s+/g, "\\s+");
  const continuation = new RegExp(`(?:^|\\s)${titlePattern}\\s*(?:[-–—]|\\()\\s*\\S`, "i");
  return ocrText.split(/\\r?\\n/).some((line) => continuation.test(line));
}

function isMobile(p: { number: string; type: string }) {
  if (p.type === "mobile") return true;
  if (p.type !== "unknown") return false;
  // Region "IN" is used only to classify numbers printed without a country
  // code; it is never added to the exported value.
  return parsePhoneNumberFromString(p.number, "IN")?.getType() === "MOBILE";
}

function pickPhone(e: Extraction, flags: Flag[]): string | null {
  const phones = e.phones
    .map((p) => ({ ...p, number: clean(p.number) ?? "" }))
    .filter((p) => p.number && p.type !== "fax");
  if (phones.length === 0) return null;

  const mobiles = phones.filter(isMobile);
  const pool = mobiles.length ? mobiles : phones;
  if (pool.length > 1) {
    flags.push({ code: "multiple_phones", field: "phone", severity: "review", message: `${pool.length} candidate numbers — confirm which to keep` });
  }
  const chosen = pool[0]!.number;
  if (!parsePhoneNumberFromString(chosen, "IN")?.isValid()) {
    flags.push({ code: "phone_unverified", field: "phone", severity: "review", message: "Phone number did not validate — check digits" });
  }
  return chosen;
}

function pickName(e: Extraction, flags: Flag[]) {
  let first = clean(e.first_name);
  let last = clean(e.last_name);
  const full = clean(e.full_name)?.replace(HONORIFIC, "") ?? null;

  if (!first && !last && full) {
    const parts = full.split(" ");
    last = parts.length > 1 ? parts.pop()! : null;
    first = parts.join(" ");
    flags.push({ code: "name_split_uncertain", field: "lastName", severity: "review", message: "Name was split automatically" });
  }
  first = first?.replace(HONORIFIC, "") || null;

  const initial = /^[A-Za-z]\.?$/;
  if (first?.split(" ").some((t) => initial.test(t))) {
    flags.push({ code: "name_initials", field: "firstName", severity: "review", message: "First name is initials — check the split" });
  } else if (last?.split(" ").some((t) => initial.test(t))) {
    flags.push({ code: "name_initials", field: "lastName", severity: "review", message: "Last name contains initials — check the split" });
  }
  const tokens = (full ?? `${first ?? ""} ${last ?? ""}`).trim().split(" ").filter(Boolean);
  if (tokens.length > 3 && !flags.some((f) => f.code === "name_split_uncertain")) {
    flags.push({ code: "name_split_uncertain", field: "lastName", severity: "review", message: "Long name — check first/last split" });
  }
  return { first, last };
}

export function buildCard(e: Extraction, ocrText: string | null): CardResult {
  const flags: Flag[] = [];
  const printedCompany = clean(e.company);
  const site = hostOf(clean(e.website));
  const { first, last } = pickName(e, flags);
  const email = pickEmail(e, printedCompany, site, flags);
  const company = printedCompany ?? companyFromEmail(email);
  flagCompanyFromEmail(company, email, e, ocrText, flags);

  const fields: ContactFields = {
    firstName: first,
    lastName: last,
    company,
    email,
    jobTitle: clean(e.job_title),
    phone: pickPhone(e, flags),
  };

  if (fields.jobTitle && !fields.firstName && !fields.lastName) {
    flags.push({
      code: "job_title_without_name",
      field: "jobTitle",
      severity: "review",
      message: "Job title found without a named person — confirm whether it is a role label",
    });
  }

  if (fields.jobTitle && ocrText && titleMayBeTruncated(fields.jobTitle, ocrText)) {
    flags.push({
      code: "title_may_be_truncated",
      field: "jobTitle",
      severity: "review",
      message: "The card text appears to continue after the extracted job title — check the full title",
    });
  }

  for (const f of REQUIRED_FIELDS) {
    if (f === "lastName" && fields.firstName) continue;
    if (!fields[f]) flags.push({ code: "missing", field: f, severity: "review", message: "Required field missing" });
  }

  if (ocrText) {
    for (const f of ALL_FIELDS) {
      const v = fields[f];
      if (v && !isOnCard(v, ocrText, f === "phone" ? "phone" : "text")) {
        flags.push({ code: "not_on_card", field: f as FieldName, severity: "review", message: "Not found in the card text — verify" });
      }
    }
  }

  let status: CardStatus;
  if (!e.is_business_card) status = { kind: "skipped", reason: "not_a_card" };
  else if (e.language.toLowerCase() !== "en") status = { kind: "skipped", reason: "non_english" };
  else if (!fields.email) status = { kind: "skipped", reason: "no_email" };
  else status = flags.some((f) => f.severity === "review") ? { kind: "needs_review" } : { kind: "looks_good" };

  return { fields, flags, status };
}
