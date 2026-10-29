// Checks that an extracted value is actually printed on the card, by fuzzy
// matching it against independent OCR text. This is the main guard against a
// vision model inventing plausible-looking values.

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (s: string) => s.replace(/\D/g, "");

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** True if `needle` occurs in `haystack` with at most `maxEdits` edits. */
function fuzzyContains(haystack: string, needle: string, maxEdits: number): boolean {
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  for (let len = needle.length - maxEdits; len <= needle.length + maxEdits; len++) {
    if (len <= 0) continue;
    for (let start = 0; start + len <= haystack.length; start++) {
      if (levenshtein(haystack.slice(start, start + len), needle) <= maxEdits) return true;
    }
  }
  return false;
}

/** Allowed OCR edits: roughly 1 per 8 characters, at least 1. */
const editBudget = (len: number) => Math.max(1, Math.floor(len / 8));

export function isOnCard(value: string, ocrText: string, kind: "text" | "phone" = "text"): boolean {
  if (kind === "phone") {
    const d = digits(value);
    // Country codes are often printed differently ("+91", "0091", omitted), so
    // compare the last 10 digits.
    const tail = d.slice(-10);
    return fuzzyContains(digits(ocrText), tail, 1);
  }
  const v = alnum(value);
  return fuzzyContains(alnum(ocrText), v, editBudget(v.length));
}
