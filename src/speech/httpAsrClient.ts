import { z } from "zod";

import type { AppEnv } from "../config/env.js";
import type {
  AsrClient,
  AsrRoute,
  AsrRoutingInput,
  AsrTranscriptionResult,
  LanguageConfidence,
  SpeechLanguage
} from "./types.js";

const asrResponseSchema = z
  .object({
    text: z.string().optional(),
    transcript: z.string().optional(),
    language: z.enum(["ja", "en", "mixed", "unknown"]).optional(),
    clipped: z.boolean().optional(),
    audioSeconds: z.number().min(0).optional(),
    jaConfidence: z.number().min(0).max(1).optional(),
    enConfidence: z.number().min(0).max(1).optional(),
    languageConfidence: z
      .object({
        ja: z.number().min(0).max(1),
        en: z.number().min(0).max(1)
      })
      .optional()
  })
  .passthrough();

interface NormalizedAsrResponse {
  text: string;
  language: SpeechLanguage;
  confidence: LanguageConfidence;
  clipped: boolean;
}

export class HttpAsrClient implements AsrClient {
  constructor(private readonly env: AppEnv) {}

  async transcribeWithRouting(input: AsrRoutingInput): Promise<AsrTranscriptionResult> {
    const hintedRoute = routeFromHint(input.languageHint);
    const fast = await this.fastDecode(input, hintedRoute);
    const route = selectRoute({
      confidence: fast.confidence,
      threshold: this.env.ASR_LANGUAGE_THRESHOLD,
      routeHint: hintedRoute
    });

    const detailed = await this.detailedDecode(route, input, fast);
    const language = resolveLanguage(detailed.text, detailed.language, route);

    return {
      text: detailed.text,
      language,
      route,
      languageConfidence: detailed.confidence
    };
  }

  private async fastDecode(input: AsrRoutingInput, routeHint: AsrRoute | null): Promise<NormalizedAsrResponse> {
    if (routeHint && routeHint !== "mixed" && this.env.ASR_SKIP_FAST_WHEN_HINTED) {
      return {
        text: "",
        language: routeHint,
        confidence: confidenceFromLanguage(routeHint),
        clipped: false
      };
    }

    if (!this.env.ASR_FAST_URL) {
      return {
        text: "",
        language: input.languageHint ?? "unknown",
        confidence: confidenceFromLanguage(input.languageHint ?? "unknown"),
        clipped: false
      };
    }

    const payload = {
      audioBase64: input.audioBase64,
      mimeType: input.mimeType,
      model: this.env.ASR_MODEL_FAST
    };

    const raw = await postJson(this.env.ASR_FAST_URL, payload, this.env.ASR_FAST_TIMEOUT_MS);
    return normalizeAsrResponse(raw);
  }

  private async detailedDecode(
    route: AsrRoute,
    input: AsrRoutingInput,
    fast: NormalizedAsrResponse
  ): Promise<NormalizedAsrResponse> {
    const endpointByRoute: Record<AsrRoute, string | undefined> = {
      ja: this.env.ASR_JA_URL,
      en: this.env.ASR_EN_URL,
      mixed: this.env.ASR_MIXED_URL
    };

    const modelByRoute: Record<AsrRoute, string> = {
      ja: this.env.ASR_MODEL_JA,
      en: this.env.ASR_MODEL_EN,
      mixed: this.env.ASR_MODEL_MIXED
    };

    if (this.shouldReuseFastResult(route, fast, modelByRoute)) {
      return fast;
    }

    const endpoint = endpointByRoute[route];
    if (!endpoint) {
      if (fast.text.trim().length > 0) {
        return fast;
      }
      throw new Error(`ASR endpoint for route '${route}' is not configured`);
    }

    const payload = {
      audioBase64: input.audioBase64,
      mimeType: input.mimeType,
      model: modelByRoute[route]
    };
    const raw = await postJson(endpoint, payload, this.env.ASR_DECODE_TIMEOUT_MS);
    const decoded = normalizeAsrResponse(raw);

    if (!decoded.text.trim() && fast.text.trim()) {
      return fast;
    }
    if (!decoded.text.trim()) {
      throw new Error("ASR returned an empty transcript");
    }
    return decoded;
  }

  private shouldReuseFastResult(
    route: AsrRoute,
    fast: NormalizedAsrResponse,
    modelByRoute: Record<AsrRoute, string>
  ): boolean {
    if (!this.env.ASR_SKIP_REDUNDANT_DECODE) {
      return false;
    }
    if (route === "mixed") {
      return false;
    }
    if (!this.env.ASR_FAST_URL) {
      return false;
    }
    if (fast.clipped) {
      return false;
    }
    if (!fast.text.trim()) {
      return false;
    }
    return modelByRoute[route] === this.env.ASR_MODEL_FAST;
  }
}

function selectRoute(input: {
  confidence: LanguageConfidence;
  threshold: number;
  routeHint: AsrRoute | null;
}): AsrRoute {
  if (input.routeHint) {
    return input.routeHint;
  }

  if (input.confidence.ja > input.confidence.en && input.confidence.ja >= input.threshold) {
    return "ja";
  }
  if (input.confidence.en > input.confidence.ja && input.confidence.en >= input.threshold) {
    return "en";
  }
  return "mixed";
}

function resolveLanguage(text: string, language: SpeechLanguage, route: AsrRoute): SpeechLanguage {
  if (language !== "unknown") {
    return language;
  }
  if (route === "mixed") {
    return hasJapanese(text) && /[a-z]/i.test(text) ? "mixed" : hasJapanese(text) ? "ja" : "en";
  }
  return route;
}

function hasJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
}

function routeFromHint(languageHint: AsrRoutingInput["languageHint"]): AsrRoute | null {
  if (!languageHint) {
    return null;
  }
  return languageHint;
}

function normalizeAsrResponse(payload: unknown): NormalizedAsrResponse {
  const parsed = asrResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("ASR response schema mismatch");
  }

  const data = parsed.data;
  const text = (data.text ?? data.transcript ?? "").trim();
  const language = data.language ?? "unknown";
  const confidence = data.languageConfidence ?? {
    ja: data.jaConfidence ?? confidenceFromLanguage(language).ja,
    en: data.enConfidence ?? confidenceFromLanguage(language).en
  };

  return {
    text,
    language,
    confidence,
    clipped: data.clipped ?? true
  };
}

function confidenceFromLanguage(language: SpeechLanguage): LanguageConfidence {
  if (language === "ja") {
    return { ja: 0.9, en: 0.1 };
  }
  if (language === "en") {
    return { ja: 0.1, en: 0.9 };
  }
  if (language === "mixed") {
    return { ja: 0.5, en: 0.5 };
  }
  return { ja: 0.5, en: 0.5 };
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`ASR request timed out (${url}, ${timeoutMs}ms)`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `ASR endpoint is unreachable (${url}). Start ASR worker with "npm run asr-worker:start". Detail: ${detail}`
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ASR endpoint failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
