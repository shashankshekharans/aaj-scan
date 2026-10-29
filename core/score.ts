// Scores a pipeline's CardResult against verified ground truth.
// "Silent" = wrong and not flagged on that field — the metric that matters most.

import { ALL_FIELDS, type CardResult, type ContactFields, type FieldName, type SkipReason } from "./types";

export interface Truth {
  file: string;
  /** Set when the card should be skipped (e.g. no email printed). */
  skip?: SkipReason;
  fields: ContactFields;
  notes?: string;
}

export type FieldOutcome = "correct" | "wrong_flagged" | "wrong_silent";

export interface CardScore {
  file: string;
  fields: { field: FieldName; outcome: FieldOutcome; expected: string | null; got: string | null }[];
  skipOutcome: "not_applicable" | "correct_skip" | "missed_skip_flagged" | "missed_skip_silent" | "wrong_skip";
  status: CardResult["status"]["kind"];
  cardCorrect: boolean;
  /** Wrong-and-unflagged fields on a card marked looks_good (would be bulk-approved). */
  silentOnLooksGood: number;
}

function norm(field: FieldName, v: string | null): string | null {
  if (!v) return null;
  if (field === "phone") return v.replace(/\D/g, "").slice(-10) || null;
  return v.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim() || null;
}

export function scoreCard(truth: Truth, result: CardResult): CardScore {
  const status = result.status.kind;
  const base = { file: truth.file, status, fields: [] as CardScore["fields"], silentOnLooksGood: 0 };

  if (truth.skip) {
    const skipOutcome =
      result.status.kind === "skipped" ? "correct_skip" : status === "looks_good" ? "missed_skip_silent" : "missed_skip_flagged";
    return { ...base, skipOutcome, cardCorrect: skipOutcome === "correct_skip" };
  }
  if (result.status.kind === "skipped") {
    return { ...base, skipOutcome: "wrong_skip", cardCorrect: false };
  }

  const flagged = new Set(result.flags.filter((f) => f.severity === "review").map((f) => f.field));
  const fields = ALL_FIELDS.map((field) => {
    const expected = truth.fields[field];
    const got = result.fields[field];
    const outcome: FieldOutcome =
      norm(field, expected) === norm(field, got) ? "correct" : flagged.has(field) ? "wrong_flagged" : "wrong_silent";
    return { field, outcome, expected, got };
  });

  const silent = fields.filter((f) => f.outcome === "wrong_silent").length;
  return {
    ...base,
    fields,
    skipOutcome: "not_applicable",
    cardCorrect: fields.every((f) => f.outcome === "correct"),
    silentOnLooksGood: status === "looks_good" ? silent : 0,
  };
}

export interface Summary {
  cards: number;
  fieldAccuracy: Record<FieldName, number>;
  /** All wrong-and-unflagged fields, plus cards that should have been skipped but looked good. */
  silentErrors: number;
  silentOnLooksGood: number;
  /** Share of cards needing individual review. */
  flagRate: number;
  /** Share of looks_good cards that were fully correct. */
  looksGoodPrecision: number;
  wrongSkips: number;
  missedSkips: number;
}

export function summarize(scores: CardScore[]): Summary {
  const scored = scores.filter((s) => s.skipOutcome === "not_applicable");
  const fieldAccuracy = Object.fromEntries(
    ALL_FIELDS.map((f) => {
      const hits = scored.filter((s) => s.fields.find((x) => x.field === f)?.outcome === "correct").length;
      return [f, scored.length ? hits / scored.length : 0];
    }),
  ) as Record<FieldName, number>;
  const looksGood = scored.filter((s) => s.status === "looks_good");
  const missedSilent = scores.filter((s) => s.skipOutcome === "missed_skip_silent").length;

  return {
    cards: scores.length,
    fieldAccuracy,
    silentErrors: scored.reduce((n, s) => n + s.fields.filter((f) => f.outcome === "wrong_silent").length, 0) + missedSilent,
    silentOnLooksGood: scored.reduce((n, s) => n + s.silentOnLooksGood, 0) + missedSilent,
    flagRate: scores.length ? scores.filter((s) => s.status === "needs_review").length / scores.length : 0,
    looksGoodPrecision: looksGood.length ? looksGood.filter((s) => s.cardCorrect).length / looksGood.length : 0,
    wrongSkips: scores.filter((s) => s.skipOutcome === "wrong_skip").length,
    missedSkips: scores.filter((s) => s.skipOutcome.startsWith("missed_skip")).length,
  };
}
