import { describe, expect, it } from "vitest";

import type { LlmClient } from "../src/llm/types.js";
import {
  generateDiscussionReply,
  generateHelpJaReply,
  generateShadowingScript,
  summarizeArticle
} from "../src/session/trainingEngine.js";
import type { TrainingSession } from "../src/session/trainingSessionStore.js";

function createMockClient(text: string): LlmClient {
  return {
    async generateText() {
      return {
        provider: "nemotron",
        model: "nemotron-3-nano",
        text
      };
    }
  };
}

const session: TrainingSession = {
  sessionId: "s1",
  articleTitle: "Test title",
  articleText: "Article text",
  summary: "Summary text",
  history: [],
  expiresAt: Date.now() + 1000
};

describe("trainingEngine", () => {
  it("parses article summary labels", async () => {
    const client = createMockClient(
      [
        "SHORT: quick summary",
        "BULLET1: point one",
        "BULLET2: point two",
        "BULLET3: point three",
        "STARTER: what do you think?"
      ].join("\n")
    );

    const summary = await summarizeArticle(client, "title", "long article text");
    expect(summary.short).toBe("quick summary");
    expect(summary.bullets).toHaveLength(3);
    expect(summary.discussionStarter).toBe("what do you think?");
  });

  it("parses discussion response", async () => {
    const client = createMockClient(
      "REPHRASE: I agree with this point.\nREPLY: Nice point.\nFOLLOW_UP: Why do you think so?"
    );
    const result = await generateDiscussionReply(client, session, "My opinion", "en");
    expect(result.reformulatedLearnerMessage).toContain("agree");
    expect(result.reply).toContain("Nice point");
    expect(result.followUpQuestion).toContain("Why");
    expect(result.inputLanguage).toBe("en");
  });

  it("parses japanese help response", async () => {
    const client = createMockClient(
      [
        "REPLY: この表現が自然です。",
        "JA_EXPLANATION: ニュアンスは控えめな批判です。",
        "EN_PHRASE: The outlook seems overly optimistic.",
        "EX1: The outlook seems overly optimistic in this report.",
        "EX2: I feel the outlook is a bit too optimistic."
      ].join("\n")
    );

    const result = await generateHelpJaReply(client, session, "日本語の質問");
    expect(result.expressionHint.en).toContain("optimistic");
    expect(result.expressionHint.examples).toHaveLength(2);
  });

  it("parses shadowing response", async () => {
    const client = createMockClient(
      [
        "LINE1: First line.",
        "LINE2: Second line.",
        "LINE3: Third line.",
        "LINE4: Fourth line.",
        "FOCUS: policy, inflation, outlook"
      ].join("\n")
    );

    const result = await generateShadowingScript(client, session, "normal");
    expect(result.script).toHaveLength(4);
    expect(result.focusWords).toContain("policy");
  });

  it("retries shadowing generation by translating to english when japanese is returned", async () => {
    let calls = 0;
    const client: LlmClient = {
      async generateText() {
        calls += 1;
        if (calls === 1) {
          return {
            provider: "nemotron",
            model: "nemotron-3-nano",
            text: [
              "LINE1: 日本語の行です。",
              "LINE2: これも日本語です。",
              "LINE3: 練習文です。",
              "LINE4: 最後の行です。",
              "FOCUS: 発音, 練習"
            ].join("\n")
          };
        }
        return {
          provider: "nemotron",
          model: "nemotron-3-nano",
          text: [
            "LINE1: This is the first practice line.",
            "LINE2: This is the second practice line.",
            "LINE3: This is the third practice line.",
            "LINE4: This is the fourth practice line.",
            "FOCUS: pronunciation, rhythm"
          ].join("\n")
        };
      }
    };

    const result = await generateShadowingScript(client, session, "normal");
    expect(calls).toBe(2);
    expect(result.script[0]).toContain("first practice line");
    expect(result.focusWords).toContain("pronunciation");
  });

  it("fails shadowing generation when japanese remains after translation retry", async () => {
    let calls = 0;
    const client: LlmClient = {
      async generateText() {
        calls += 1;
        return {
          provider: "nemotron",
          model: "nemotron-3-nano",
          text: [
            "LINE1: 日本語の行です。",
            "LINE2: これも日本語です。",
            "LINE3: 練習文です。",
            "LINE4: 最後の行です。",
            "FOCUS: 発音, 練習"
          ].join("\n")
        };
      }
    };

    await expect(generateShadowingScript(client, session, "normal")).rejects.toThrow(
      "Shadowing文の生成に失敗しました。もう一度ボタンを押してください。"
    );
    expect(calls).toBe(2);
  });

  it("uses article-grounded guidance on first discussion turn", async () => {
    let capturedPrompt = "";
    const client: LlmClient = {
      async generateText(input) {
        capturedPrompt = input.prompt;
        return {
          provider: "nemotron",
          model: "nemotron-3-nano",
          text: "REPHRASE: I agree.\nREPLY: Good point.\nFOLLOW_UP: Why?"
        };
      }
    };

    const firstTurnSession: TrainingSession = {
      ...session,
      history: []
    };

    await generateDiscussionReply(client, firstTurnSession, "My view", "en");
    expect(capturedPrompt).toContain("first discussion turn after the article summary");
  });

  it("uses flexible-topic guidance after first discussion turn", async () => {
    let capturedPrompt = "";
    const client: LlmClient = {
      async generateText(input) {
        capturedPrompt = input.prompt;
        return {
          provider: "nemotron",
          model: "nemotron-3-nano",
          text: "REPHRASE: I agree.\nREPLY: Good point.\nFOLLOW_UP: Why?"
        };
      }
    };

    const laterTurnSession: TrainingSession = {
      ...session,
      history: [
        { role: "user", text: "First opinion", mode: "discussion" },
        { role: "assistant", text: "First reply", mode: "discussion" }
      ]
    };

    await generateDiscussionReply(client, laterTurnSession, "By the way, another topic", "en");
    expect(capturedPrompt).toContain("later discussion turn");
    expect(capturedPrompt).toContain("Prioritize the learner's latest topic");
  });
});
