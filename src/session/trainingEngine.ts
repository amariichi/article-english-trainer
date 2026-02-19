import type { LlmClient, LlmProvider } from "../llm/types.js";
import type { TrainingSession } from "./trainingSessionStore.js";

export interface SummaryResult {
  short: string;
  bullets: string[];
  discussionStarter: string;
  provider: LlmProvider;
  model: string;
}

export interface DiscussionResult {
  reformulatedLearnerMessage: string;
  reply: string;
  followUpQuestion: string;
  inputLanguage: "ja" | "en" | "mixed" | "unknown";
  provider: LlmProvider;
  model: string;
}

export interface HelpJaResult {
  reply: string;
  expressionHint: {
    ja: string;
    en: string;
    examples: string[];
  };
  provider: LlmProvider;
  model: string;
}

export interface ShadowingResult {
  script: string[];
  focusWords: string[];
  provider: LlmProvider;
  model: string;
}

export class ShadowingGenerationError extends Error {}

export async function summarizeArticle(
  client: LlmClient,
  articleTitle: string,
  articleText: string
): Promise<SummaryResult> {
  const response = await client.generateText({
    systemPrompt:
      "You are an English conversation coach. Keep outputs concise, factual, and practical for learners.",
    prompt: [
      "Read the article and return exactly these labeled lines:",
      "SHORT: one sentence summary in plain English.",
      "BULLET1: key point.",
      "BULLET2: key point.",
      "BULLET3: key point.",
      "STARTER: one discussion question for an English learner."
    ].join("\n"),
    context: `Title: ${articleTitle}\n\n${articleText.slice(0, 12000)}`,
    temperature: 0.4
  });

  const short = pickLabeledLine(response.text, "SHORT") ?? firstSentence(response.text);
  const bullets = [
    pickLabeledLine(response.text, "BULLET1"),
    pickLabeledLine(response.text, "BULLET2"),
    pickLabeledLine(response.text, "BULLET3")
  ].filter((item): item is string => Boolean(item && item.trim()));

  const discussionStarter =
    pickLabeledLine(response.text, "STARTER") ?? "What is your opinion about the author's main argument?";

  return {
    short,
    bullets: bullets.length >= 3 ? bullets : fallbackBullets(response.text),
    discussionStarter,
    provider: response.provider,
    model: response.model
  };
}

export async function generateDiscussionReply(
  client: LlmClient,
  session: TrainingSession,
  userMessage: string,
  inputLanguage: "ja" | "en" | "mixed" | "unknown" = "unknown"
): Promise<DiscussionResult> {
  const history = formatHistory(session);
  const priorAssistantDiscussionTurns = countAssistantDiscussionTurns(session);
  const isFirstDiscussionTurn = priorAssistantDiscussionTurns === 0;
  const turnGuidance = isFirstDiscussionTurn
    ? "This is the first discussion turn after the article summary. Ground your reply in the article context."
    : "This is a later discussion turn. Prioritize the learner's latest topic. You may move beyond the article when relevant.";

  const response = await client.generateText({
    systemPrompt:
      "You are an English speaking tutor. First restate the learner's intended meaning in natural English, then continue the conversation in natural English.",
    prompt: [
      "Continue the conversation in English.",
      turnGuidance,
      "Use article context only when helpful. Do not force article references.",
      "Return exactly these labels:",
      "REPHRASE: natural English restatement of the learner message. If learner used Japanese, translate to natural English.",
      "REPLY: one short paragraph in English.",
      "FOLLOW_UP: one follow-up question in English."
    ].join("\n"),
    context: [
      `Article title: ${session.articleTitle}`,
      `Article summary: ${session.summary}`,
      `Recent history:\n${history}`,
      `Learner message language: ${inputLanguage}`,
      `Learner message: ${userMessage}`
    ].join("\n\n"),
    temperature: 0.5
  });

  const reformulatedLearnerMessage = pickLabeledLine(response.text, "REPHRASE") ?? normalizeAsSentence(userMessage);
  const reply = pickLabeledLine(response.text, "REPLY") ?? response.text.trim();
  const followUpQuestion =
    pickLabeledLine(response.text, "FOLLOW_UP") ?? "Could you explain why you think that?";

  return {
    reformulatedLearnerMessage,
    reply,
    followUpQuestion,
    inputLanguage,
    provider: response.provider,
    model: response.model
  };
}

export async function generateHelpJaReply(
  client: LlmClient,
  session: TrainingSession,
  userMessage: string
): Promise<HelpJaResult> {
  const history = formatHistory(session);

  const response = await client.generateText({
    systemPrompt:
      "You are a bilingual English coach. Answer in Japanese for explanation, and include practical English expression examples.",
    prompt: [
      "The learner asked in Japanese.",
      "Return exactly these labels:",
      "REPLY: short Japanese explanation.",
      "JA_EXPLANATION: one sentence with nuance.",
      "EN_PHRASE: one recommended English phrase.",
      "EX1: first English example sentence.",
      "EX2: second English example sentence."
    ].join("\n"),
    context: [
      `Article title: ${session.articleTitle}`,
      `Article summary: ${session.summary}`,
      `Recent history:\n${history}`,
      `Learner question (Japanese): ${userMessage}`
    ].join("\n\n"),
    temperature: 0.4
  });

  const reply = pickLabeledLine(response.text, "REPLY") ?? "この文脈で使いやすい表現を以下にまとめます。";
  const ja = pickLabeledLine(response.text, "JA_EXPLANATION") ?? reply;
  const en = pickLabeledLine(response.text, "EN_PHRASE") ?? "The outlook seems overly optimistic.";
  const examples = [pickLabeledLine(response.text, "EX1"), pickLabeledLine(response.text, "EX2")].filter(
    (item): item is string => Boolean(item && item.trim())
  );

  return {
    reply,
    expressionHint: {
      ja,
      en,
      examples: examples.length > 0 ? examples : [`In my view, ${en.toLowerCase()}`]
    },
    provider: response.provider,
    model: response.model
  };
}

export async function generateShadowingScript(
  client: LlmClient,
  session: TrainingSession,
  difficulty: "easy" | "normal" | "hard"
): Promise<ShadowingResult> {
  const response = await client.generateText({
    systemPrompt:
      "You are a pronunciation coach. Create short, natural lines suitable for shadowing practice.",
    prompt: [
      `Generate ${difficulty} shadowing lines based on the article context.`,
      "Return in this format:",
      "LINE1: ...",
      "LINE2: ...",
      "LINE3: ...",
      "LINE4: ...",
      "FOCUS: comma separated key words."
    ].join("\n"),
    context: `Article title: ${session.articleTitle}\nSummary: ${session.summary}`,
    temperature: 0.6
  });

  let script = readShadowingLines(response.text);
  let focusWords = readFocusWords(response.text);

  if (containsJapaneseText(script.join(" "))) {
    const translated = await client.generateText({
      systemPrompt:
        "You are an English pronunciation coach. Rewrite provided lines into natural English-only shadowing practice lines.",
      prompt: [
        "The previous output contained Japanese. Rewrite or translate it into English.",
        "Return exactly these labels:",
        "LINE1: ...",
        "LINE2: ...",
        "LINE3: ...",
        "LINE4: ...",
        "FOCUS: comma separated key words.",
        "Do not include Japanese characters."
      ].join("\n"),
      context: [
        `Article title: ${session.articleTitle}`,
        `Article summary: ${session.summary}`,
        `Difficulty: ${difficulty}`,
        `Original output:\n${response.text}`
      ].join("\n\n"),
      temperature: 0.2
    });

    script = readShadowingLines(translated.text);
    focusWords = readFocusWords(translated.text);

    if (script.length < 3 || containsJapaneseText(script.join(" "))) {
      throw new ShadowingGenerationError("Shadowing文の生成に失敗しました。もう一度ボタンを押してください。");
    }
  }

  return {
    script: script.length >= 3 ? script : fallbackShadowingLines(session.summary),
    focusWords,
    provider: response.provider,
    model: response.model
  };
}

function pickLabeledLine(text: string, label: string): string | null {
  const regex = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const match = text.match(regex);
  return match?.[1]?.trim() ?? null;
}

function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const [sentence] = normalized.split(/(?<=[.!?])\s+/);
  return sentence || "Summary is currently unavailable.";
}

function normalizeAsSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "I want to explain my opinion more clearly.";
  }
  return normalized.replace(/[.?!]+$/, "");
}

function fallbackBullets(text: string): string[] {
  const cleaned = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => line.length > 15)
    .slice(0, 3);

  if (cleaned.length === 3) {
    return cleaned;
  }

  return [
    "The article presents a central argument with supporting evidence.",
    "It highlights trade-offs that affect policy and society.",
    "It suggests questions about long-term consequences."
  ];
}

function fallbackShadowingLines(summary: string): string[] {
  return [
    "The article argues that policy choices shape long-term outcomes.",
    "I agree with some points, but I remain cautious about the risks.",
    `In short, ${firstSentence(summary).replace(/\.$/, "")}.`,
    "A balanced response requires both evidence and flexibility."
  ];
}

function countAssistantDiscussionTurns(session: TrainingSession): number {
  return session.history.filter((entry) => entry.mode === "discussion" && entry.role === "assistant").length;
}

function readShadowingLines(text: string): string[] {
  return ["LINE1", "LINE2", "LINE3", "LINE4"]
    .map((label) => pickLabeledLine(text, label))
    .filter((item): item is string => Boolean(item && item.trim()));
}

function readFocusWords(text: string): string[] {
  const focusRaw = pickLabeledLine(text, "FOCUS") ?? "economy, policy, outlook";
  return focusRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function containsJapaneseText(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(text);
}

function formatHistory(session: TrainingSession): string {
  if (session.history.length === 0) {
    return "(no history yet)";
  }

  return session.history
    .slice(-8)
    .map((entry) => `${entry.role.toUpperCase()} [${entry.mode}]: ${entry.text}`)
    .join("\n");
}
