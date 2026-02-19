import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEnv } from "../src/config/env.js";
import { HttpAsrClient } from "../src/speech/httpAsrClient.js";

describe("HttpAsrClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes to JA endpoint when ja confidence is high", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ languageConfidence: { ja: 0.82, en: 0.18 } }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "こんにちは", language: "ja" }), {
          status: 200
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const env = loadEnv({
      ASR_FAST_URL: "http://127.0.0.1:9201/fast",
      ASR_JA_URL: "http://127.0.0.1:9201/ja",
      ASR_EN_URL: "http://127.0.0.1:9201/en",
      ASR_MIXED_URL: "http://127.0.0.1:9201/mixed",
      ASR_LANGUAGE_THRESHOLD: "0.75"
    });

    const client = new HttpAsrClient(env);
    const result = await client.transcribeWithRouting({
      audioBase64: "AAAABBBBCCCCDDDDEEEEFFFF",
      mimeType: "audio/webm"
    });

    expect(result.route).toBe("ja");
    expect(result.language).toBe("ja");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9201/ja",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("routes to mixed endpoint when confidence is low", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ languageConfidence: { ja: 0.55, en: 0.45 } }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "今日は market が不安定です", language: "mixed" }), {
          status: 200
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const env = loadEnv({
      ASR_FAST_URL: "http://127.0.0.1:9202/fast",
      ASR_JA_URL: "http://127.0.0.1:9202/ja",
      ASR_EN_URL: "http://127.0.0.1:9202/en",
      ASR_MIXED_URL: "http://127.0.0.1:9202/mixed",
      ASR_LANGUAGE_THRESHOLD: "0.75"
    });

    const client = new HttpAsrClient(env);
    const result = await client.transcribeWithRouting({
      audioBase64: "AAAABBBBCCCCDDDDEEEEFFFF",
      mimeType: "audio/webm"
    });

    expect(result.route).toBe("mixed");
    expect(result.language).toBe("mixed");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9202/mixed",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("skips fast decode when explicit language hint is set", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "hello there", language: "en" }), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = loadEnv({
      ASR_FAST_URL: "http://127.0.0.1:9203/fast",
      ASR_JA_URL: "http://127.0.0.1:9203/ja",
      ASR_EN_URL: "http://127.0.0.1:9203/en",
      ASR_MIXED_URL: "http://127.0.0.1:9203/mixed",
      ASR_LANGUAGE_THRESHOLD: "0.75",
      ASR_SKIP_FAST_WHEN_HINTED: "true"
    });

    const client = new HttpAsrClient(env);
    const result = await client.transcribeWithRouting({
      audioBase64: "AAAABBBBCCCCDDDDEEEEFFFF",
      mimeType: "audio/webm",
      languageHint: "en"
    });

    expect(result.route).toBe("en");
    expect(result.language).toBe("en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9203/en",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reuses fast transcript when route model matches and audio is not clipped", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          text: "I think inflation is easing.",
          language: "en",
          clipped: false,
          languageConfidence: { ja: 0.08, en: 0.92 }
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = loadEnv({
      ASR_FAST_URL: "http://127.0.0.1:9204/fast",
      ASR_JA_URL: "http://127.0.0.1:9204/ja",
      ASR_EN_URL: "http://127.0.0.1:9204/en",
      ASR_MIXED_URL: "http://127.0.0.1:9204/mixed",
      ASR_LANGUAGE_THRESHOLD: "0.75",
      ASR_SKIP_REDUNDANT_DECODE: "true"
    });

    const client = new HttpAsrClient(env);
    const result = await client.transcribeWithRouting({
      audioBase64: "AAAABBBBCCCCDDDDEEEEFFFF",
      mimeType: "audio/webm"
    });

    expect(result.route).toBe("en");
    expect(result.text).toContain("inflation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9204/fast",
      expect.objectContaining({ method: "POST" })
    );
  });
});
