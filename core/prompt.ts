// Provider-neutral extraction prompt and JSON Schema. Every provider adapter
// sends the same instructions so results are comparable.

export const EXTRACTION_PROMPT = `You read photos of business cards and return the printed contact details as JSON.

Rules:
- Copy text exactly as printed. Do not translate, correct spelling, expand abbreviations, or reformat.
- Use null (or an empty list) for anything not printed on the card. Never guess or infer: do not build an email from a website, do not add country codes, do not fill a company from an email domain.
- full_name: the person's name as printed, without honorifics like "Dr." or "Mr.".
- first_name / last_name: split full_name. Initials belong to first_name (e.g. "R. K. Sharma" -> first "R. K.", last "Sharma"). If the card shows only one name, put it in first_name and set last_name to null.
- job_title: the person's designation only, not the department or company.
- company: the organisation name as printed, including suffixes like "Pvt Ltd".
- emails: every email address on the card.
- phones: every phone number as printed. type: "mobile" for labels like M, Mob, Mobile, Cell, WhatsApp; "office" for T, Tel, Ph, Off, Office, Board, Landline; "fax" for F, Fax; otherwise "unknown".
- website: as printed, or null.
- language: ISO 639-1 code of the main language of the card ("en" for English).
- is_business_card: false if the image is not a business card or is unreadable.`;

const nullableString = { type: ["string", "null"] } as const;

/** Standard JSON Schema (draft 2020-12 subset accepted by the providers). */
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_business_card: { type: "boolean" },
    language: { type: "string" },
    full_name: nullableString,
    first_name: nullableString,
    last_name: nullableString,
    job_title: nullableString,
    company: nullableString,
    emails: { type: "array", items: { type: "string" } },
    phones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: { type: "string" },
          type: { type: "string", enum: ["mobile", "office", "fax", "unknown"] },
        },
        required: ["number", "type"],
      },
    },
    website: nullableString,
  },
  required: [
    "is_business_card", "language", "full_name", "first_name", "last_name",
    "job_title", "company", "emails", "phones", "website",
  ],
} as const;
