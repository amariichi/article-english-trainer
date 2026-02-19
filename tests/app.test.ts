import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import type { GenerateTextInput, LlmClient, LlmProvider } from "../src/llm/types.js";
import type { AsrClient, TtsClient } from "../src/speech/types.js";

function createMockClient(provider: LlmProvider): LlmClient {
  return {
    async generateText(input: GenerateTextInput) {
      if (input.prompt.includes("BULLET1")) {
        return {
          provider,
          model: provider === "nemotron" ? "nemotron-3-nano" : "gemini-3.0-flash",
          text: [
            "SHORT: summary sentence",
            "BULLET1: key point one",
            "BULLET2: key point two",
            "BULLET3: key point three",
            "STARTER: Do you agree with the author?"
          ].join("\n")
        };
      }

      if (input.prompt.includes("FOLLOW_UP")) {
        return {
          provider,
          model: provider === "nemotron" ? "nemotron-3-nano" : "gemini-3.0-flash",
          text: [
            "REPHRASE: I think the outlook is too optimistic.",
            "REPLY: Interesting perspective.",
            "FOLLOW_UP: Can you give one example?"
          ].join("\n")
        };
      }

      if (input.prompt.includes("JA_EXPLANATION")) {
        return {
          provider,
          model: provider === "nemotron" ? "nemotron-3-nano" : "gemini-3.0-flash",
          text: [
            "REPLY: この表現が使えます。",
            "JA_EXPLANATION: 控えめな否定です。",
            "EN_PHRASE: The outlook seems overly optimistic.",
            "EX1: The outlook seems overly optimistic to me.",
            "EX2: I think the outlook is a bit too optimistic."
          ].join("\n")
        };
      }

      if (input.prompt.includes("LINE1")) {
        return {
          provider,
          model: provider === "nemotron" ? "nemotron-3-nano" : "gemini-3.0-flash",
          text: [
            "LINE1: First line.",
            "LINE2: Second line.",
            "LINE3: Third line.",
            "LINE4: Fourth line.",
            "FOCUS: policy, inflation, outlook"
          ].join("\n")
        };
      }

      return {
        provider,
        model: provider === "nemotron" ? "nemotron-3-nano" : "gemini-3.0-flash",
        text: "REPLY: default"
      };
    }
  };
}

const mockAsrClient: AsrClient = {
  async transcribeWithRouting(input) {
    if (input.languageHint === "ja") {
      return {
        text: "この見通しは楽観的すぎると思います",
        language: "ja",
        route: "ja",
        languageConfidence: { ja: 0.9, en: 0.1 }
      };
    }
    return {
      text: "I think the forecast is too optimistic.",
      language: "en",
      route: "en",
      languageConfidence: { ja: 0.1, en: 0.9 }
    };
  }
};

const mockTtsClient: TtsClient = {
  async synthesize(input) {
    return {
      backend: "http_audio",
      dispatched: true,
      audioBase64: "UklGRiQAAABXQVZFZm10",
      mimeType: "audio/wav",
      voice: input.voice ?? "af_heart",
      language: input.language
    };
  }
};

describe("app integration", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    LLM_PROVIDER: "nemotron",
    ALLOW_PROVIDER_OVERRIDE: "false"
  });

  const app = createApp({
    env,
    fetchArticle: async (url: string) => ({
      url,
      title: "Article",
      text: "a".repeat(3000),
      fetchedAt: new Date().toISOString()
    }),
    asrClient: mockAsrClient,
    ttsClient: mockTtsClient,
    createClient: (provider) => createMockClient(provider)
  });

  it("returns health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns config", async () => {
    const response = await request(app).get("/api/config");
    expect(response.status).toBe(200);
    expect(response.body.availableProviders).toEqual(["nemotron", "gemini"]);
    expect(response.body.micMaxRecordingMs).toBe(20000);
  });

  it("runs manual article flow and session endpoints", async () => {
    const manual = await request(app).post("/api/article/manual").send({
      title: "Manual title",
      text: "b".repeat(800)
    });

    expect(manual.status).toBe(200);
    const sessionId = manual.body.sessionId as string;
    expect(sessionId).toBeTruthy();
    expect(manual.body.speech?.language).toBe("en");

    const discussion = await request(app).post("/api/session/message").send({
      sessionId,
      mode: "discussion",
      message: "I agree with the article"
    });

    expect(discussion.status).toBe(200);
    expect(discussion.body.reply).toContain("A more natural way to say that is:");
    expect(discussion.body.followUpQuestion).toContain("example");
    expect(discussion.body.speech.voice).toBe("af_heart");
    expect(discussion.body.speech.language).toBe("en");

    const help = await request(app).post("/api/session/message").send({
      sessionId,
      mode: "help_ja",
      message: "日本語で説明して"
    });

    expect(help.status).toBe(200);
    expect(help.body.expressionHint.en).toContain("optimistic");
    expect(help.body.speech.voice).toBe("af_heart");
    expect(help.body.speech.language).toBe("ja");

    const shadowing = await request(app).post("/api/session/shadowing").send({
      sessionId,
      difficulty: "normal"
    });

    expect(shadowing.status).toBe(200);
    expect(shadowing.body.script.length).toBeGreaterThanOrEqual(3);
    expect(shadowing.body.speech.voice).toBe("af_heart");
    expect(shadowing.body.speech.language).toBe("en");
  });

  it("handles audio turn with ASR routing and TTS response", async () => {
    const manual = await request(app).post("/api/article/manual").send({
      title: "Manual title",
      text: "b".repeat(800)
    });
    const sessionId = manual.body.sessionId as string;

    const response = await request(app).post("/api/session/audio-turn").send({
      sessionId,
      audioBase64: "AAAABBBBCCCCDDDDEEEEFFFFGGGG",
      mimeType: "audio/webm",
      languageHint: "ja"
    });

    expect(response.status).toBe(200);
    expect(response.body.transcript.language).toBe("ja");
    expect(response.body.transcript.route).toBe("ja");
    expect(response.body.assistant.mode).toBe("discussion");
    expect(response.body.assistant.reply).toContain("In English, you could say:");
    expect(response.body.speech.voice).toBe("af_heart");
    expect(response.body.speech.language).toBe("en");

    const uploadResponse = await request(app)
      .post(
        `/api/session/audio-turn-upload?sessionId=${encodeURIComponent(sessionId)}&mimeType=audio/webm&languageHint=en`
      )
      .set("content-type", "audio/webm")
      .send(Buffer.from("AAAAABBBBBCCCCCDDDDDEEEEEFFFFFGGGGG"));

    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body.transcript.language).toBe("en");
    expect(uploadResponse.body.transcript.route).toBe("en");
    expect(uploadResponse.body.assistant.mode).toBe("discussion");
  });

  it("routes romaji japanese request to help_ja in audio turn", async () => {
    const romajiAsrClient: AsrClient = {
      async transcribeWithRouting() {
        return {
          text: "Nihongo de hanashite kudasai.",
          language: "en",
          route: "en",
          languageConfidence: { ja: 0.15, en: 0.85 }
        };
      }
    };

    const romajiApp = createApp({
      env,
      fetchArticle: async (url: string) => ({
        url,
        title: "Article",
        text: "a".repeat(3000),
        fetchedAt: new Date().toISOString()
      }),
      asrClient: romajiAsrClient,
      ttsClient: mockTtsClient,
      createClient: (provider) => createMockClient(provider)
    });

    const manual = await request(romajiApp).post("/api/article/manual").send({
      title: "Manual title",
      text: "b".repeat(800)
    });
    const sessionId = manual.body.sessionId as string;

    const response = await request(romajiApp).post("/api/session/audio-turn").send({
      sessionId,
      audioBase64: "AAAABBBBCCCCDDDDEEEEFFFFGGGG",
      mimeType: "audio/webm"
    });

    expect(response.status).toBe(200);
    expect(response.body.transcript.language).toBe("en");
    expect(response.body.assistant.mode).toBe("help_ja");
    expect(response.body.speech.language).toBe("ja");
  });

  it("returns retry guidance when shadowing stays japanese after retry", async () => {
    function createShadowingFailClient(provider: LlmProvider): LlmClient {
      const base = createMockClient(provider);
      return {
        async generateText(input: GenerateTextInput) {
          if (input.prompt.includes("Generate normal shadowing lines") || input.prompt.includes("previous output contained Japanese")) {
            return {
              provider,
              model: provider === "nemotron" ? "nemotron-3-nano" : "gemini-3.0-flash",
              text: [
                "LINE1: 日本語の行です。",
                "LINE2: これも日本語です。",
                "LINE3: 練習文です。",
                "LINE4: 最後の行です。",
                "FOCUS: 発音, 練習"
              ].join("\n")
            };
          }
          return base.generateText(input);
        }
      };
    }

    const failingShadowingApp = createApp({
      env,
      fetchArticle: async (url: string) => ({
        url,
        title: "Article",
        text: "a".repeat(3000),
        fetchedAt: new Date().toISOString()
      }),
      asrClient: mockAsrClient,
      ttsClient: mockTtsClient,
      createClient: (provider) => createShadowingFailClient(provider)
    });

    const manual = await request(failingShadowingApp).post("/api/article/manual").send({
      title: "Manual title",
      text: "b".repeat(800)
    });
    const sessionId = manual.body.sessionId as string;

    const shadowing = await request(failingShadowingApp).post("/api/session/shadowing").send({
      sessionId,
      difficulty: "normal"
    });

    expect(shadowing.status).toBe(422);
    expect(shadowing.body.error).toContain("Shadowing文の生成に失敗しました。もう一度ボタンを押してください。");
  });

  it("rejects provider override when disabled", async () => {
    const response = await request(app).post("/api/article/manual").send({
      title: "Manual title",
      text: "b".repeat(800),
      provider: "gemini"
    });

    expect(response.status).toBe(403);
  });

  it("rejects gpt-oss-20b provider", async () => {
    const response = await request(app).post("/api/article/manual").send({
      title: "Manual title",
      text: "b".repeat(800),
      provider: "gpt-oss-20b"
    });

    expect(response.status).toBe(400);
  });
});
