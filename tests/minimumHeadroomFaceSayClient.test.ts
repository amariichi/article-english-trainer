import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEnv } from "../src/config/env.js";
import {
  MinimumHeadroomFaceSayClient,
  normalizeMinimumHeadroomSpeechText
} from "../src/speech/minimumHeadroomFaceSayClient.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeMinimumHeadroomSpeechText", () => {
  it("maps japanese punctuation to spaces", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("こんにちは。ありがとう、助かる・本当に", "ja");
    expect(normalized).toBe("こんにちは ありがとう 助かる 本当に");
  });

  it("returns empty string for punctuation-only input", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("。、、・・。。。", "ja");
    expect(normalized).toBe("");
  });

  it("replaces inline hyphen with space for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("I work 9-to-5.", "en");
    expect(normalized).toBe("I work 9 to 5.");
  });

  it("replaces inline unicode dash with space for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("A 9‑to‑5 schedule.", "en");
    expect(normalized).toBe("A 9 to 5 schedule.");
  });

  it("keeps non-hyphen text unchanged for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("This is fine.", "en");
    expect(normalized).toBe("This is fine.");
  });

  it("normalizes smart apostrophe for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("That’s fine.", "en");
    expect(normalized).toBe("That's fine.");
  });

  it("normalizes smart double quotes for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("He said, “Hello”.", "en");
    expect(normalized).toBe('He said, "Hello".');
  });

  it("normalizes ellipsis and narrow no-break spaces for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("Wait…A\u202FB", "en");
    expect(normalized).toBe("Wait...A B");
  });

  it("normalizes latin diacritics for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("café naïve rôle crêpe", "en");
    expect(normalized).toBe("cafe naive role crepe");
  });

  it("keeps japanese characters intact while normalizing latin diacritics", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("日本語が café", "en");
    expect(normalized).toBe("日本語が cafe");
  });

  it("keeps full-width symbols untouched for english", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("ＡＢＣ！", "en");
    expect(normalized).toBe("ＡＢＣ！");
  });

  it("does not modify japanese text", () => {
    const normalized = normalizeMinimumHeadroomSpeechText("日本語-英語", "ja");
    expect(normalized).toBe("日本語-英語");
  });
});

describe("MinimumHeadroomFaceSayClient", () => {
  it("skips dispatch when normalized text becomes empty", async () => {
    const webSocketConstructorCalls = vi.fn();
    class UnexpectedWebSocket {
      constructor() {
        webSocketConstructorCalls();
        throw new Error("WebSocket should not be constructed");
      }

      addEventListener(): void {}

      removeEventListener(): void {}

      send(): void {}

      close(): void {}
    }

    vi.stubGlobal("WebSocket", UnexpectedWebSocket as unknown as typeof WebSocket);

    const env = loadEnv({
      TTS_BACKEND: "minimum_headroom_face_say"
    });
    const client = new MinimumHeadroomFaceSayClient(env);
    const result = await client.synthesize({
      text: "。、、・・。。。",
      language: "ja"
    });

    expect(result).toBeNull();
    expect(webSocketConstructorCalls).not.toHaveBeenCalled();
  });
});
