// Evaluation runner: compares extraction methods on the card photos in
// eval/cards against verified ground truth in eval/ground-truth.json.
//
//   npm run eval                          all configured providers + OCR-only
//   npm run eval -- --methods gemini,ocr  pick methods
//   npm run eval -- --limit 3             first N cards only (cheap smoke test)
//   npm run eval -- --fresh               ignore cached model answers
//   npm run eval -- --no-grounding        skip the OCR cross-check (for comparison)
//   --cards <dir> --truth <file> --results <dir>   override default locations
//
// Model answers are cached in eval/results/raw so re-scoring costs no quota.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { parseExtraction } from "../core/extraction";
import { parseOcrText } from "../core/ocrParse";
import { buildCard } from "../core/postprocess";
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from "../core/prompt";
import { scoreCard, summarize, type CardScore, type Summary, type Truth } from "../core/score";
import type { CardResult } from "../core/types";
import { QuotaExhaustedError, RateLimitError, type Provider } from "./providers/common";
import { PROVIDERS } from "./providers/index";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const ROOT = import.meta.dirname;
const CARDS = opt("cards") ?? join(ROOT, "cards");
const RESULTS = opt("results") ?? join(ROOT, "results");
const TRUTH = opt("truth") ?? join(ROOT, "ground-truth.json");

if (existsSync(join(ROOT, "..", ".env"))) process.loadEnvFile(join(ROOT, "..", ".env"));

// ~10 requests/minute keeps us under the strictest free per-minute limits seen.
const DELAY_MS = Number(opt("delay") ?? 6500);
const MAX_RETRIES = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MethodRun {
  method: string;
  model: string;
  results: Map<string, CardResult | { error: string }>;
  latencyMs: number[];
  calls: number;
  stoppedReason?: string;
}

/** Same preparation the phone will do: fix rotation, cap size, re-encode (drops EXIF/GPS). */
async function prepare(file: string) {
  const buf = await sharp(join(CARDS, file)).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { buf, base64: buf.toString("base64") };
}

async function main() {
  const files = readdirSync(CARDS).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f)).sort().slice(0, opt("limit") ? Number(opt("limit")) : undefined);
  if (files.length === 0) {
    console.error(`No card photos found. Put them in ${CARDS}`);
    process.exit(1);
  }
  const truth: Truth[] | null = existsSync(TRUTH) ? JSON.parse(readFileSync(TRUTH, "utf8")) : null;
  if (!truth) console.warn("No eval/ground-truth.json yet — running extraction only, no scoring.\n");

  const configured = PROVIDERS.filter((p) => p.requiredEnv.every((k) => process.env[k]));
  const wanted = opt("methods")?.split(",");
  const providers = wanted ? configured.filter((p) => wanted.includes(p.id)) : configured;
  const runOcrOnly = !wanted || wanted.includes("ocr");
  const missing = PROVIDERS.filter((p) => !configured.includes(p)).map((p) => `${p.id} (needs ${p.requiredEnv.join(", ")})`);
  if (missing.length) console.warn(`Not configured, skipped: ${missing.join("; ")}\n`);

  for (const d of ["ocr", "raw", ...providers.map((p) => join("raw", p.id))]) mkdirSync(join(RESULTS, d), { recursive: true });

  // 1. Prepare images and OCR once per card (cached).
  const prepared = new Map<string, Awaited<ReturnType<typeof prepare>>>();
  const ocr = new Map<string, string>();
  // Keep the downloaded language model out of the project root.
  const worker = await createWorker("eng", undefined, { cachePath: join(ROOT, "..", "node_modules", ".cache", "tesseract") });
  for (const f of files) {
    const img = await prepare(f);
    prepared.set(f, img);
    const cache = join(RESULTS, "ocr", `${f}.txt`);
    if (existsSync(cache) && !flag("fresh")) ocr.set(f, readFileSync(cache, "utf8"));
    else {
      const { data } = await worker.recognize(img.buf);
      writeFileSync(cache, data.text);
      ocr.set(f, data.text);
    }
  }
  await worker.terminate();
  console.log(`OCR done for ${files.length} cards.`);

  const grounding = !flag("no-grounding");
  const runs: MethodRun[] = [];

  // 2. OCR-only baseline.
  if (runOcrOnly) {
    const run: MethodRun = { method: "ocr-only", model: "tesseract.js + rules", results: new Map(), latencyMs: [], calls: 0 };
    for (const f of files) {
      const r = buildCard(parseOcrText(ocr.get(f)!), null);
      r.flags.push({ code: "ocr_only", severity: "review", message: "Read without AI — review every field" });
      if (r.status.kind === "looks_good") r.status = { kind: "needs_review" };
      run.results.set(f, r);
    }
    runs.push(run);
  }

  // 3. Each provider.
  for (const p of providers) runs.push(await runProvider(p, files, prepared, ocr, grounding));

  // 4. Report.
  writeReport(runs, files, truth, grounding);
}

async function runProvider(p: Provider, files: string[], prepared: Map<string, { base64: string }>, ocr: Map<string, string>, grounding: boolean): Promise<MethodRun> {
  const run: MethodRun = { method: p.id, model: p.model(), results: new Map(), latencyMs: [], calls: 0 };
  console.log(`\n${p.id} (${p.model()})`);
  for (const f of files) {
    const cache = join(RESULTS, "raw", p.id, `${f}.json`);
    let raw: string | null = null;
    if (existsSync(cache) && !flag("fresh")) {
      const c = JSON.parse(readFileSync(cache, "utf8"));
      if (c.model === p.model()) raw = c.raw;
    }
    if (raw === null && run.stoppedReason) {
      run.results.set(f, { error: `not run: ${run.stoppedReason}` });
      continue;
    }
    if (raw === null) {
      for (let attempt = 0; ; attempt++) {
        const t0 = performance.now();
        try {
          run.calls++;
          raw = await p.extract({ imageBase64: prepared.get(f)!.base64, mimeType: "image/jpeg", prompt: EXTRACTION_PROMPT, schema: EXTRACTION_SCHEMA });
          const ms = Math.round(performance.now() - t0);
          run.latencyMs.push(ms);
          writeFileSync(cache, JSON.stringify({ model: p.model(), ms, raw }, null, 2));
          break;
        } catch (e) {
          if (e instanceof RateLimitError && attempt < MAX_RETRIES) {
            const wait = e.retryAfterMs ?? DELAY_MS * 2 ** attempt;
            console.log(`  ${f}: rate limited, waiting ${Math.round(wait / 1000)}s`);
            await sleep(wait);
            continue;
          }
          const msg = (e as Error).message;
          if (e instanceof QuotaExhaustedError || e instanceof RateLimitError) run.stoppedReason = `quota exhausted after ${run.calls} calls`;
          run.results.set(f, { error: msg });
          console.log(`  ${f}: ERROR ${msg.slice(0, 200)}`);
          break;
        }
      }
      await sleep(DELAY_MS);
    }
    if (raw === null) continue;
    try {
      const r = buildCard(parseExtraction(raw), grounding ? ocr.get(f)! : null);
      run.results.set(f, r);
      console.log(`  ${f}: ${r.status.kind}${r.flags.length ? " — " + r.flags.map((x) => x.code + (x.field ? ":" + x.field : "")).join(", ") : ""}`);
    } catch (e) {
      run.results.set(f, { error: `unparseable answer: ${(e as Error).message}` });
      console.log(`  ${f}: unparseable answer`);
    }
  }
  return run;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);

function writeReport(runs: MethodRun[], files: string[], truth: Truth[] | null, grounding: boolean) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const lines: string[] = [`# Extraction evaluation — ${new Date().toISOString().slice(0, 16)}`, "", `Cards: ${files.length} · OCR grounding: ${grounding ? "on" : "off"}`, ""];
  const json: Record<string, unknown> = {};

  if (!truth) {
    lines.push("No ground truth yet — extraction output only.", "");
    for (const run of runs) {
      lines.push(`## ${run.method} (${run.model})`, "", "| Card | Status | First | Last | Company | Email | Title | Phone | Flags |", "|---|---|---|---|---|---|---|---|---|");
      for (const f of files) {
        const r = run.results.get(f);
        if (!r || "error" in r) lines.push(`| ${f} | ERROR | ${r ? r.error.slice(0, 80) : "—"} |||||||`);
        else {
          const x = r.fields;
          lines.push(`| ${f} | ${r.status.kind === "skipped" ? "skipped:" + r.status.reason : r.status.kind} | ${x.firstName ?? ""} | ${x.lastName ?? ""} | ${x.company ?? ""} | ${x.email ?? ""} | ${x.jobTitle ?? ""} | ${x.phone ?? ""} | ${r.flags.map((g) => g.code + (g.field ? ":" + g.field : "")).join(", ")} |`);
        }
      }
      lines.push("");
      json[run.method] = Object.fromEntries(run.results);
    }
  } else {
    const byFile = new Map(truth.map((t) => [basename(t.file), t]));
    const summaries: [MethodRun, Summary, CardScore[], number][] = runs.map((run) => {
      const scores: CardScore[] = [];
      let errors = 0;
      for (const f of files) {
        const t = byFile.get(f);
        const r = run.results.get(f);
        if (!t) continue;
        if (!r || "error" in r) errors++;
        else scores.push(scoreCard(t, r));
      }
      return [run, summarize(scores), scores, errors];
    });

    lines.push(
      "| Method | Model | Scored | Errors | Silent errors | Silent on 'looks good' | Flag rate | 'Looks good' fully correct | First | Last | Company | Email | Title | Phone | Wrong skips | Median latency |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const [run, s, , errors] of summaries) {
      const a = s.fieldAccuracy;
      lines.push(`| ${run.method} | ${run.model} | ${s.cards} | ${errors} | ${s.silentErrors} | ${s.silentOnLooksGood} | ${pct(s.flagRate)} | ${pct(s.looksGoodPrecision)} | ${pct(a.firstName)} | ${pct(a.lastName)} | ${pct(a.company)} | ${pct(a.email)} | ${pct(a.jobTitle)} | ${pct(a.phone)} | ${s.wrongSkips} | ${(median(run.latencyMs) / 1000).toFixed(1)}s |`);
    }
    lines.push("", "Targets (PRD §5): silent errors ≤ 1 across the set · flag rate ≤ 30% · required-field accuracy ≥ 95% on 'looks good' cards.", "");

    for (const [run, , scores] of summaries) {
      lines.push(`## ${run.method} — mistakes`, "");
      if (run.stoppedReason) lines.push(`Stopped early: ${run.stoppedReason}`, "");
      const bad = scores.flatMap((s) =>
        s.skipOutcome !== "not_applicable" && s.skipOutcome !== "correct_skip"
          ? [`- ${s.file}: ${s.skipOutcome} (status ${s.status})`]
          : s.fields.filter((f) => f.outcome !== "correct").map((f) => `- ${s.file} · ${f.field}: expected \`${f.expected ?? "∅"}\`, got \`${f.got ?? "∅"}\` — **${f.outcome}**`),
      );
      lines.push(...(bad.length ? bad : ["None."]), "");
      json[run.method] = { scores };
    }
  }

  const md = join(RESULTS, `report-${stamp}.md`);
  writeFileSync(md, lines.join("\n"));
  writeFileSync(join(RESULTS, `report-${stamp}.json`), JSON.stringify(json, null, 2));
  console.log(`\nReport: ${md}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
