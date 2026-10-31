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
    const e = { ...base, company: null, emails: ["priya.nair@gmail.com"] };
    const r = buildCard(e, ocrFor(e));
    expect(codes(r)).toContain("missing:company");
    expect(r.status).toEqual({ kind: "needs_review" });
  });

  it("derives a missing company from a business email domain and flags it", () => {
    const e = { ...base, company: null, emails: ["order@brandict.com"], website: null };
    const r = buildCard(e, ocrFor(e));
    expect(r.fields.company).toBe("Brandict");
    expect(codes(r)).toContain("company_from_email:company");
    expect(codes(r)).not.toContain("missing:company");
    expect(r.status).toEqual({ kind: "needs_review" });
  });

  it("flags a model-supplied company that exactly matches the email domain", () => {
    const e = { ...base, company: "Craloft", emails: ["ali@craloft.com"], website: null };
    const r = buildCard(e, "Mansur Ali\nali@craloft.com\nHead - Corporate Sales");
    expect(r.fields.company).toBe("Craloft");
    expect(codes(r)).toContain("company_from_email:company");
    expect(r.status).toEqual({ kind: "needs_review" });
  });

  it("does not flag a company independently printed as well as used in the email domain", () => {
    const e = { ...base, company: "Brandict", emails: ["order@brandict.com"], website: null };
    expect(codes(buildCard(e, ocrFor(e)))).not.toContain("company_from_email:company");
  });

  it("never derives a company from a personal email domain", () => {
    const e = { ...base, company: null, emails: ["priya.nair@gmail.com"], website: null };
    const r = buildCard(e, ocrFor(e));
    expect(r.fields.company).toBeNull();
    expect(codes(r)).not.toContain("company_from_email:company");
    expect(codes(r)).toContain("missing:company");
  });

  it("does not flag missing optional fields", () => {
    const e = { ...base, job_title: null, phones: [] };
    const r = buildCard(e, ocrFor(e));
    expect(r.status).toEqual({ kind: "looks_good" });
    expect(r.fields.jobTitle).toBeNull();
    expect(r.fields.phone).toBeNull();
  });

  it("accepts a single printed name without requiring a surname", () => {
    const e = { ...base, full_name: "GURPREET", first_name: "GURPREET", last_name: null };
    const r = buildCard(e, ocrFor(e));
    expect(codes(r)).not.toContain("missing:lastName");
  });

  it("flags a job title when the card names no person", () => {
    const e = { ...base, full_name: null, first_name: null, last_name: null, job_title: "SALES SUPPORT" };
    const r = buildCard(e, ocrFor(e));
    expect(codes(r)).toContain("job_title_without_name:jobTitle");
    expect(r.status).toEqual({ kind: "needs_review" });
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

  it("flags a likely one-character email-domain typo even when it resembles the company", () => {
    const e = {
      ...base,
      company: "JAI AMBAY ARTS",
      emails: ["info@jalambayarts.com"],
      website: "www.jaiambayarts.com",
    };
    expect(codes(buildCard(e, ocrFor(e)))).toContain("email_domain_mismatch:email");
  });

  it("requires review when a business email does not resemble the company and no website is present", () => {
    const e = { ...base, emails: ["info@jalambayarts.com"], website: null };
    const r = buildCard(e, ocrFor(e));
    expect(r.flags.find((f) => f.code === "email_domain_mismatch")?.severity).toBe("review");
    expect(r.status).toEqual({ kind: "needs_review" });
  });

  it("accepts an email that matches the company name even when the website differs", () => {
    // Patterns seen on real cards (fictional values): brand word inside the
    // email domain with a sister-brand website, and .in email vs .com website.
    const brand = { ...base, company: "ZEPHYR", emails: ["anita@zephyrwatch.com"], website: "www.lumora.com" };
    expect(codes(buildCard(brand, ocrFor(brand)))).not.toContain("email_domain_mismatch:email");
    const tld = { ...base, company: "Brightcook Home Appliances Pvt. Ltd.", emails: ["ravi.k@brightcook.in"], website: "www.brightcook.com" };
    expect(codes(buildCard(tld, ocrFor(tld)))).not.toContain("email_domain_mismatch:email");
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

  it("flags a job title that appears truncated before a printed suffix", () => {
    const e = { ...base, job_title: "Head" };
    const r = buildCard(e, ocrFor(e).replace("Head", "Head – Corporate Sales"));
    expect(codes(r)).toContain("title_may_be_truncated:jobTitle");
    expect(r.status).toEqual({ kind: "needs_review" });
  });

  it("does not flag a complete job title", () => {
    expect(codes(buildCard(base, ocrFor(base)))).not.toContain("title_may_be_truncated:jobTitle");
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
