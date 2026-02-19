import { randomUUID } from "node:crypto";

import type { AppEnv } from "../config/env.js";
import type { TtsClient, TtsSynthesisInput, TtsSynthesisResult } from "./types.js";

interface FaceSayResult {
  spoken: boolean | null;
  reason: string | null;
}

export class MinimumHeadroomFaceSayClient implements TtsClient {
  constructor(private readonly env: AppEnv) {}

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult | null> {
    const messageId = randomUUID();
    const normalizedText = normalizeMinimumHeadroomSpeechText(input.text, input.language);
    if (normalizedText === "") {
      return null;
    }

    const payload = {
      v: 1,
      type: "say",
      session_id: this.env.MINIMUM_HEADROOM_SESSION_ID,
      ts: Date.now(),
      utterance_id: randomUUID(),
      text: normalizedText,
      priority: this.env.MINIMUM_HEADROOM_SAY_PRIORITY,
      policy: this.env.MINIMUM_HEADROOM_SAY_POLICY,
      ttl_ms: this.env.MINIMUM_HEADROOM_SAY_TTL_MS,
      dedupe_key: null,
      message_id: messageId,
      revision: Date.now()
    };

    const result = await forwardSay(
      this.env.MINIMUM_HEADROOM_WS_URL,
      payload,
      this.env.MINIMUM_HEADROOM_SAY_TIMEOUT_MS
    );

    return {
      backend: "minimum_headroom_face_say",
      dispatched: true,
      voice: input.voice ?? this.env.TTS_DEFAULT_VOICE,
      language: input.language,
      dispatchResult: {
        spoken: result.spoken,
        reason: result.reason,
        messageId
      }
    };
  }
}

async function forwardSay(
  wsUrl: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<FaceSayResult> {
  const WS = getWebSocketConstructor();
  return await new Promise((resolve, reject) => {
    const socket = new WS(wsUrl);
    let settled = false;

    const settle = (error: Error | null, response?: FaceSayResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      try {
        socket.close();
      } catch {
        // Ignore close failures on cleanup path.
      }

      if (error) {
        reject(error);
        return;
      }
      resolve(response ?? { spoken: null, reason: null });
    };

    const timeout = setTimeout(() => {
      settle(null, {
        spoken: null,
        reason: "timeout-no-say_result"
      });
    }, timeoutMs);

    const onOpen = (): void => {
      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        settle(new Error(`face_say send failed: ${message}`));
      }
    };

    const onMessage = (event: MessageEvent): void => {
      const data = typeof event.data === "string" ? event.data : null;
      if (!data) {
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }

      if (!isMatchingSayResult(message, payload.message_id)) {
        return;
      }

      settle(null, {
        spoken: typeof message.spoken === "boolean" ? message.spoken : null,
        reason: typeof message.reason === "string" ? message.reason : null
      });
    };

    const onError = (): void => {
      settle(new Error(`face_say WebSocket connection failed: ${wsUrl}`));
    };

    const onClose = (): void => {
      settle(null, {
        spoken: null,
        reason: "closed-before-say_result"
      });
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage as EventListener);
    socket.addEventListener("error", onError as EventListener);
    socket.addEventListener("close", onClose as EventListener);
  });
}

function getWebSocketConstructor(): typeof WebSocket {
  if (typeof WebSocket !== "function") {
    throw new Error("Global WebSocket is unavailable in this Node runtime");
  }
  return WebSocket;
}

function isMatchingSayResult(
  payload: unknown,
  expectedMessageId: unknown
): payload is { type: "say_result"; spoken?: unknown; reason?: unknown; message_id?: unknown } {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const message = payload as Record<string, unknown>;
  if (message.type !== "say_result") {
    return false;
  }
  return message.message_id === expectedMessageId;
}

export function normalizeMinimumHeadroomSpeechText(text: string, _language: "ja" | "en"): string {
  let normalized = text
    // Normalize common English smart punctuation into ASCII equivalents.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    // Silence Japanese punctuation-only utterances by converting to separators.
    .replace(/[。、・]+/g, " ")
    // Normalize no-break spaces that sometimes appear in copied English text.
    .replace(/[\u00A0\u202F]/g, " ");

  // Strip combining diacritics only when they are attached to Latin letters
  // (e.g. café -> cafe, naïve -> naive, rôle -> role), then recompose.
  normalized = normalized
    .normalize("NFD")
    .replace(/([\p{Script=Latin}])\p{M}+/gu, "$1")
    .normalize("NFC");

  // Normalize inline dash variants (e.g. 9-to-5, state-of-the-art) for clearer English TTS.
  normalized = normalized.replace(/([A-Za-z0-9])[-‐‑‒–—−]([A-Za-z0-9])/g, "$1 $2");
  return normalized.replace(/\s+/g, " ").trim();
}
