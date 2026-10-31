// Provider adapters. Request shapes follow each provider's docs as checked on
// 2026-10-29; details the docs did not confirm are handled by withFallback.

import { chatText, env, postJson, withFallback, type Provider } from "./common";

const dataUrl = (c: { mimeType: string; imageBase64: string }) => `data:${c.mimeType};base64,${c.imageBase64}`;

export const gemini: Provider = {
  id: "gemini",
  requiredEnv: ["GEMINI_API_KEY"],
  model: () => process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
  async extract(c) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model()}:generateContent`;
    const headers = { "x-goog-api-key": env("GEMINI_API_KEY") };
    const contents = [{ parts: [{ text: c.prompt }, { inline_data: { mime_type: c.mimeType, data: c.imageBase64 } }] }];
    const call = (generationConfig: object) => postJson(url, headers, { contents, generationConfig });
    const json = (await withFallback(
      () => call({ responseMimeType: "application/json", responseJsonSchema: c.schema, temperature: 0 }),
      () => call({ responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: c.schema } }, temperature: 0 }),
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(json).slice(0, 300)}`);
    return text;
  },
};

export const groq: Provider = {
  id: "groq",
  requiredEnv: ["GROQ_API_KEY"],
  model: () => process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
  async extract(c) {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const headers = { authorization: `Bearer ${env("GROQ_API_KEY")}` };
    const base = {
      model: this.model(),
      temperature: 0,
      reasoning_effort: "none",
      messages: [{ role: "user", content: [{ type: "text", text: c.prompt }, { type: "image_url", image_url: { url: dataUrl(c) } }] }],
    };
    const json = await withFallback(
      () => postJson(url, headers, { ...base, response_format: { type: "json_schema", json_schema: { name: "card", strict: true, schema: c.schema } } }),
      () => postJson(url, headers, { ...base, response_format: { type: "json_object" } }),
    );
    return chatText(json);
  },
};

export const cloudflare: Provider = {
  id: "cloudflare",
  requiredEnv: ["CF_ACCOUNT_ID", "CF_API_TOKEN"],
  model: () => process.env.CF_MODEL ?? "@cf/google/gemma-4-26b-a4b-it",
  async extract(c) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${env("CF_ACCOUNT_ID")}/ai/run/${this.model()}`;
    const headers = { authorization: `Bearer ${env("CF_API_TOKEN")}` };
    const base = {
      temperature: 0,
      // Gemma 4 uses part of the completion budget for internal reasoning.
      // A 1,024-token cap can therefore yield an empty or truncated JSON
      // answer even though the extraction itself succeeded.
      max_tokens: 4096,
      messages: [{ role: "user", content: [{ type: "text", text: c.prompt }, { type: "image_url", image_url: { url: dataUrl(c) } }] }],
    };
    const call = (body: object) => postJson(url, headers, body, 150_000);
    const json = (await withFallback(
      () => call({ ...base, response_format: { type: "json_schema", json_schema: c.schema } }),
      () => call(base),
    )) as { result?: { response?: unknown; choices?: unknown } };
    const r = json.result;
    if (r?.choices) return chatText(r);
    if (typeof r?.response === "string") return r.response;
    if (r?.response && typeof r.response === "object") return JSON.stringify(r.response);
    throw new Error(`Cloudflare returned no text: ${JSON.stringify(json).slice(0, 300)}`);
  },
};

export const mistral: Provider = {
  id: "mistral",
  requiredEnv: ["MISTRAL_API_KEY"],
  model: () => process.env.MISTRAL_MODEL ?? "mistral-small-latest",
  async extract(c) {
    const url = "https://api.mistral.ai/v1/chat/completions";
    const headers = { authorization: `Bearer ${env("MISTRAL_API_KEY")}` };
    const base = {
      model: this.model(),
      temperature: 0,
      messages: [{ role: "user", content: [{ type: "text", text: c.prompt }, { type: "image_url", image_url: dataUrl(c) }] }],
    };
    const json = await withFallback(
      () => postJson(url, headers, { ...base, response_format: { type: "json_schema", json_schema: { name: "card", strict: true, schema: c.schema } } }),
      () => postJson(url, headers, { ...base, response_format: { type: "json_object" } }),
    );
    return chatText(json);
  },
};

export const PROVIDERS: Provider[] = [gemini, groq, cloudflare, mistral];
