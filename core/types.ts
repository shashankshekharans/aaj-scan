// Shared types for the extraction pipeline. Used by the eval harness now and
// by the proxy Worker and the PWA later, so keep this file dependency-free.

export type PhoneType = "mobile" | "office" | "fax" | "unknown";

/** Raw structured output requested from a vision model (see schema.ts). */
export interface Extraction {
  is_business_card: boolean;
  /** ISO 639-1 code of the card's main language, e.g. "en". */
  language: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company: string | null;
  emails: string[];
  phones: { number: string; type: PhoneType }[];
  website: string | null;
}

/** The exported contact — one row of the HubSpot CSV (minus Event Name). */
export interface ContactFields {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  jobTitle: string | null;
  phone: string | null;
}

export type FieldName = keyof ContactFields;

export type FlagCode =
  | "missing"
  | "invalid_email"
  | "email_domain_mismatch"
  | "company_from_email"
  | "personal_email"
  | "multiple_emails"
  | "multiple_phones"
  | "phone_unverified"
  | "name_initials"
  | "name_split_uncertain"
  | "job_title_without_name"
  | "title_may_be_truncated"
  | "not_on_card"
  | "ocr_only";

export interface Flag {
  code: FlagCode;
  /** Field the flag is about; undefined for card-level flags. */
  field?: FieldName;
  /** "review" blocks bulk approval; "info" is shown but does not. */
  severity: "review" | "info";
  message: string;
}

export type SkipReason = "no_email" | "non_english" | "not_a_card";

export type CardStatus =
  | { kind: "looks_good" }
  | { kind: "needs_review" }
  | { kind: "skipped"; reason: SkipReason };

export interface CardResult {
  fields: ContactFields;
  flags: Flag[];
  status: CardStatus;
}

export const REQUIRED_FIELDS: FieldName[] = ["firstName", "lastName", "company", "email"];
export const ALL_FIELDS: FieldName[] = ["firstName", "lastName", "company", "email", "jobTitle", "phone"];
