import { describe, expect, it } from "vitest";
import { scoreCard, summarize, type Truth } from "./score";
import type { CardResult, ContactFields } from "./types";

const fields: ContactFields = {
  firstName: "Priya",
  lastName: "Nair",
  company: "Acme Freight Pvt Ltd",
  email: "priya.nair@acmefreight.in",
  jobTitle: "Head of Logistics",
  phone: "+91 98450 12345",
};
const truth: Truth = { file: "a.jpg", fields };
const ok: CardResult = { fields, flags: [], status: { kind: "looks_good" } };

describe("scoreCard", () => {
  it("counts all fields correct, ignoring case, spacing and phone formatting", () => {
    const r = scoreCard(truth, {
      ...ok,
      fields: { ...fields, company: "ACME  Freight Pvt Ltd", phone: "098450-12345" },
    });
    expect(r.fields.every((f) => f.outcome === "correct")).toBe(true);
    expect(r.cardCorrect).toBe(true);
  });

  it("classifies an unflagged wrong value as silent", () => {
    const r = scoreCard(truth, { ...ok, fields: { ...fields, lastName: "Nalr" } });
    expect(r.fields.find((f) => f.field === "lastName")?.outcome).toBe("wrong_silent");
    expect(r.silentOnLooksGood).toBe(1);
  });

  it("classifies a flagged wrong value as flagged", () => {
    const r = scoreCard(truth, {
      fields: { ...fields, lastName: "Nalr" },
      flags: [{ code: "not_on_card", field: "lastName", severity: "review", message: "" }],
      status: { kind: "needs_review" },
    });
    expect(r.fields.find((f) => f.field === "lastName")?.outcome).toBe("wrong_flagged");
    expect(r.silentOnLooksGood).toBe(0);
  });

  it("treats an invented value as wrong", () => {
    const r = scoreCard({ ...truth, fields: { ...fields, jobTitle: null } }, ok);
    expect(r.fields.find((f) => f.field === "jobTitle")?.outcome).toBe("wrong_silent");
  });

  it("scores expected skips", () => {
    const r = scoreCard({ file: "b.jpg", skip: "no_email", fields }, { ...ok, status: { kind: "skipped", reason: "no_email" } });
    expect(r.skipOutcome).toBe("correct_skip");
  });

  it("flags a card that should have been skipped but was marked looks_good", () => {
    const r = scoreCard({ file: "b.jpg", skip: "non_english", fields }, ok);
    expect(r.skipOutcome).toBe("missed_skip_silent");
  });

  it("flags a wrongly skipped card", () => {
    const r = scoreCard(truth, { ...ok, status: { kind: "skipped", reason: "no_email" } });
    expect(r.skipOutcome).toBe("wrong_skip");
  });
});

describe("summarize", () => {
  it("aggregates accuracy, silent errors and flag rate", () => {
    const s = summarize([
      scoreCard(truth, ok),
      scoreCard(truth, { ...ok, fields: { ...fields, lastName: "Nalr" } }),
      scoreCard(truth, { ...ok, status: { kind: "needs_review" }, flags: [{ code: "missing", field: "company", severity: "review", message: "" }], fields: { ...fields, company: null } }),
    ]);
    expect(s.cards).toBe(3);
    expect(s.silentErrors).toBe(1);
    expect(s.flagRate).toBeCloseTo(1 / 3);
    expect(s.fieldAccuracy.lastName).toBeCloseTo(2 / 3);
    expect(s.fieldAccuracy.company).toBeCloseTo(2 / 3);
    expect(s.looksGoodPrecision).toBeCloseTo(1 / 2);
  });
});
