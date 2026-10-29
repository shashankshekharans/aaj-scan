import { describe, expect, it } from "vitest";
import { buildCard } from "./postprocess";
import type { Extraction } from "./types";

const base: Extraction = {
  is_business_card: true,
  language: "en",
  full_name: "Priya Nair",
  first_name: "Priya",
  last_name: "Nair",
  job_title: "Head of Logistics",
  company: "Acme Freight Pvt Ltd",
  emails: ["priya.nair@acmefreight.in"],
  phones: [{ number: "+91 98450 12345", type: "mobile" }],
  website: "www.acmefreight.in",
};

const ocrFor = (e: Extraction) =>
  [e.full_name, e.job_title, e.company, ...e.emails, ...e.phones.map((p) => p.number), e.website]
    .filter(Boolean)
    .join("\n");

const codes = (r: ReturnType<typeof buildCard>) => r.flags.map((f) => `${f.code}${f.field ? ":" + f.field : ""}`);

describe("buildCard", () => {
  it("marks a clean card as looks_good", () => {
    const r = buildCard(base, ocrFor(base));
    expect(r.status).toEqual({ kind: "looks_good" });
    expect(r.flags.filter((f) => f.severity === "review")).toEqual([]);
    expect(r.fields).toEqual({
      firstName: "Priya",
      lastName: "Nair",
      company: "Acme Freight Pvt Ltd",
      email: "priya.nair@acmefreight.in",
      jobTitle: "Head of Logistics",
      phone: "+91 98450 12345",
    });
  });

  it("skips cards without an email", () => {
    const e = { ...base, emails: [] };
    expect(buildCard(e, ocrFor(e)).status).toEqual({ kind: "skipped", reason: "no_email" });
  });

  it("skips non-English cards", () => {
    const e = { ...base, language: "zh" };
    expect(buildCard(e, ocrFor(e)).status).toEqual({ kind: "skipped", reason: "non_english" });
  });

  it("skips images that are not business cards", () => {
    const e = { ...base, is_business_card: false };
    expect(buildCard(e, ocrFor(e)).status).toEqual({ kind: "skipped", reason: "not_a_card" });
  });

  it("flags missing required fields", () => {
    const e = { ...base, company: null };
    const r = buildCard(e, ocrFor(e));
    expect(codes(r)).toContain("missing:company");
    expect(r.status).toEqual({ kind: "needs_review" });
  });

  it("does not flag missing optional fields", () => {
    const e = { ...base, job_title: null, phones: [] };
    const r = buildCard(e, ocrFor(e));
    expect(r.status).toEqual({ kind: "looks_good" });
    expect(r.fields.jobTitle).toBeNull();
    expect(r.fields.phone).toBeNull();
  });

  it("prefers the mobile number over the office number", () => {
    const e: Extraction = {
      ...base,
      phones: [
        { number: "+91 80 4123 4567", type: "office" },
        { number: "+91 98450 12345", type: "mobile" },
      ],
    };
    const r = buildCard(e, ocrFor(e));
    expect(r.fields.phone).toBe("+91 98450 12345");
    expect(codes(r)).not.toContain("multiple_phones:phone");
  });

  it("flags a phone choice when two numbers have no clear type", () => {
    const e: Extraction = {
      ...base,
      phones: [
        { number: "+91 98450 12345", type: "unknown" },
        { number: "+91 99000 54321", type: "unknown" },
      ],
    };
    expect(codes(buildCard(e, ocrFor(e)))).toContain("multiple_phones:phone");
  });

  it("never exports a fax number as the phone", () => {
    const e: Extraction = { ...base, phones: [{ number: "+91 80 4123 9999", type: "fax" }] };
    expect(buildCard(e, ocrFor(e)).fields.phone).toBeNull();
  });

  it("flags an invalid email", () => {
    const e = { ...base, emails: ["priya.nair@acmefreight"] };
    expect(codes(buildCard(e, ocrFor(e)))).toContain("invalid_email:email");
  });

  it("flags several emails and picks the one matching the company website", () => {
    const e = { ...base, emails: ["info@other.com", "priya.nair@acmefreight.in"] };
    const r = buildCard(e, ocrFor(e));
    expect(r.fields.email).toBe("priya.nair@acmefreight.in");
    expect(codes(r)).toContain("multiple_emails:email");
  });

  it("flags an email domain that does not match the website", () => {
    const e = { ...base, emails: ["priya@unrelated.co"] };
    expect(codes(buildCard(e, ocrFor(e)))).toContain("email_domain_mismatch:email");
  });

  it("notes a personal email without blocking approval", () => {
    const e = { ...base, emails: ["priya.nair@gmail.com"] };
    const r = buildCard(e, ocrFor(e));
    const f = r.flags.find((x) => x.code === "personal_email");
    expect(f?.severity).toBe("info");
    expect(codes(r)).not.toContain("email_domain_mismatch:email");
  });

  it("flags names written with initials", () => {
    const e = { ...base, full_name: "R. K. Sharma", first_name: "R. K.", last_name: "Sharma" };
    expect(codes(buildCard(e, ocrFor(e)))).toContain("name_initials:firstName");
  });

  it("flags long names whose split is uncertain", () => {
    const e = {
      ...base,
      full_name: "Mohammed Abdul Rahman Siddiqui",
      first_name: "Mohammed",
      last_name: "Abdul Rahman Siddiqui",
    };
    expect(codes(buildCard(e, ocrFor(e)))).toContain("name_split_uncertain:lastName");
  });

  it("flags values that do not appear in the OCR text", () => {
    const r = buildCard(base, ocrFor({ ...base, company: "Something Else Entirely" }));
    expect(codes(r)).toContain("not_on_card:company");
    expect(r.status).toEqual({ kind: "needs_review" });
  });

  it("tolerates small OCR misreads when grounding", () => {
    const ocr = ocrFor(base).replace("Logistics", "Log1stics").replace("98450 12345", "98450-12345");
    expect(codes(buildCard(base, ocr))).not.toContain("not_on_card:jobTitle");
    expect(codes(buildCard(base, ocr))).not.toContain("not_on_card:phone");
  });

  it("skips grounding when no OCR text is available", () => {
    expect(codes(buildCard(base, null)).some((c) => c.startsWith("not_on_card"))).toBe(false);
  });

  it("trims whitespace and drops empty strings", () => {
    const e = { ...base, job_title: "   ", company: "  Acme Freight Pvt Ltd " };
    const r = buildCard(e, ocrFor(base));
    expect(r.fields.jobTitle).toBeNull();
    expect(r.fields.company).toBe("Acme Freight Pvt Ltd");
  });
});
