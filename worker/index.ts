import { parseExtraction } from "../core/extraction";
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from "../core/prompt";
import {
  GeminiHttpError,
  geminiModelOrder,
  retryDelay,
  shouldRetryGemini,
  shouldRotateGeminiModel,
} from "./gemini-routing";

interface Env {
  ASSETS: Fetcher;
  AI: { run(model: string, input: unknown): Promise<unknown> };
  TEAM_PASSCODE: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  GEMINI_MODELS?: string;
  CF_MODEL?: string;
}

interface ExtractRequest {
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

async function sameSecret(a: string, b: string): Promise<boolean> {
  const encode = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [left, right] = await Promise.all([encode(a), encode(b)]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return difference === 0;
}

async function authorized(request: Request, env: Env) {
  const supplied = request.headers.get("x-team-passcode") ?? "";
  return supplied.length > 0 && sameSecret(supplied, env.TEAM_PASSCODE);
}

function readGeminiText(value: unknown): string {
  const response = value as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no extraction");
  return text;
}

async function callGeminiModel(env: Env, input: ExtractRequest, model: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const contents = [{ parts: [{ text: EXTRACTION_PROMPT }, { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } }] }];
  const request = async (generationConfig: object) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({ contents, generationConfig }),
        signal: AbortSignal.timeout(75_000),
      });
      const body = await response.text();
      if (response.ok) return JSON.parse(body) as unknown;

      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
      const error = new GeminiHttpError(
        response.status,
        Number.isFinite(seconds) ? seconds * 1_000 : null,
        `Gemini ${model} returned ${response.status}`,
      );
      if (attempt === 0 && shouldRetryGemini(error)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(error, attempt)));
        continue;
      }
      throw error;
    }
    throw new Error(`Gemini ${model} retry limit reached`);
  };
  try {
    return readGeminiText(await request({ responseMimeType: "application/json", responseJsonSchema: EXTRACTION_SCHEMA, temperature: 0 }));
  } catch (error) {
    if (!(error instanceof GeminiHttpError) || error.status !== 400) throw error;
    return readGeminiText(await request({ responseMimeType: "application/json", temperature: 0 }));
  }
}

async function callGemini(env: Env, input: ExtractRequest) {
  const configured = env.GEMINI_MODELS ?? env.GEMINI_MODEL;
  const failures: string[] = [];
  for (const model of geminiModelOrder(configured)) {
    try {
      return { text: await callGeminiModel(env, input, model), model };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${model} failed`);
      if (!shouldRotateGeminiModel(error)) throw error;
    }
  }
  throw new Error(`Gemini model pool unavailable: ${failures.join("; ")}`);
}

function readCloudflareText(value: unknown): string {
  const result = value as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (typeof result.response === "string") return result.response;
  if (result.response && typeof result.response === "object") return JSON.stringify(result.response);
  throw new Error("Workers AI returned no extraction");
}

async function callCloudflare(env: Env, input: ExtractRequest) {
  const model = env.CF_MODEL ?? "@cf/google/gemma-4-26b-a4b-it";
  const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;
  const base = {
    temperature: 0,
    max_tokens: 4096,
    messages: [{ role: "user", content: [{ type: "text", text: EXTRACTION_PROMPT }, { type: "image_url", image_url: { url: dataUrl } }] }],
  };
  try {
    return readCloudflareText(await env.AI.run(model, { ...base, response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA } }));
  } catch {
    return readCloudflareText(await env.AI.run(model, base));
  }
}

async function parseRequest(request: Request): Promise<ExtractRequest> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 8_000_000) throw new Error("Image is too large");
  const body = await request.json() as Partial<ExtractRequest>;
  if (!body.imageBase64 || !body.mimeType || !["image/jpeg", "image/png", "image/webp"].includes(body.mimeType)) {
    throw new Error("A JPEG, PNG or WebP image is required");
  }
  if (body.imageBase64.length > 7_500_000) throw new Error("Image is too large");
  return body as ExtractRequest;
}

async function extract(request: Request, env: Env) {
  let input: ExtractRequest;
  try {
    input = await parseRequest(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400);
  }

  const failures: string[] = [];
  try {
    const result = await callGemini(env, input);
    const extraction = parseExtraction(result.text);
    return json({ provider: "gemini", model: result.model, extraction });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Gemini failed");
  }

  try {
    const extraction = parseExtraction(await callCloudflare(env, input));
    return json({ provider: "cloudflare", extraction });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Workers AI failed");
  }

  return json({ error: "All extraction providers are temporarily unavailable", providers: failures }, 503);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (!(await authorized(request, env))) return json({ error: "Incorrect team passcode" }, 401);
    if (request.method === "GET" && url.pathname === "/api/status") {
      return json({
        providers: [
          { id: "gemini", status: "active", models: geminiModelOrder(env.GEMINI_MODELS ?? env.GEMINI_MODEL) },
          { id: "cloudflare", status: "active" },
        ],
      });
    }
    if (request.method === "POST" && url.pathname === "/api/extract") return extract(request, env);
    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
