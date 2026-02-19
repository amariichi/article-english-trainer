import { z } from "zod";

import type { AppEnv } from "../config/env.js";
import { normalizeMinimumHeadroomSpeechText } from "./minimumHeadroomFaceSayClient.js";
import type { TtsClient, TtsSynthesisInput, TtsSynthesisResult } from "./types.js";

const ttsResponseSchema = z
  .object({
    audioBase64: z.string().optional(),
    audio: z.string().optional(),
    mimeType: z.string().optional(),
    voice: z.string().optional(),
    language: z.enum(["ja", "en"]).optional()
  })
  .passthrough();

export class HttpTtsClient implements TtsClient {
  constructor(private readonly env: AppEnv) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult | null> {
    if (!this.env.TTS_ENDPOINT_URL) {
      return null;
    }

    const normalizedText = normalizeMinimumHeadroomSpeechText(input.text, input.language);
    if (normalizedText === "") {
      return null;
    }

    const payload = {
      text: normalizedText,
      language: input.language,
      voice: input.voice ?? this.env.TTS_DEFAULT_VOICE
    };

    const response = await postJson(this.env.TTS_ENDPOINT_URL, payload, this.env.TTS_TIMEOUT_MS);
    const parsed = ttsResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error("TTS response schema mismatch");
    }

    const audioBase64 = parsed.data.audioBase64 ?? parsed.data.audio;
    if (!audioBase64) {
      return null;
    }

    return {
      backend: "http_audio",
      dispatched: true,
      audioBase64,
      mimeType: parsed.data.mimeType ?? "audio/wav",
      voice: parsed.data.voice ?? payload.voice,
      language: parsed.data.language ?? input.language
    };
  }
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`TTS endpoint failed (${response.status}): ${text.slice(0, 200)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
