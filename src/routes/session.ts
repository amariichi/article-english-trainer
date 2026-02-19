import { raw, Router } from "express";
import { z } from "zod";

import { resolveProvider } from "../llm/providerPolicy.js";
import type { LlmProvider } from "../llm/types.js";
import {
  generateDiscussionReply,
  generateHelpJaReply,
  generateShadowingScript,
  ShadowingGenerationError} from "../session/trainingEngine.js";
import type { TrainingSession } from "../session/trainingSessionStore.js";
import type { SpeechLanguage, TtsSynthesisResult } from "../speech/types.js";
import type { AppContext } from "../types/appContext.js";

const providerSchema = z.enum(["nemotron", "gemini"]);
const modeSchema = z.enum(["discussion", "help_ja"]);

const messageSchema = z.object({
  sessionId: z.string().min(1),
  mode: modeSchema,
  message: z.string().min(1),
  provider: providerSchema.optional()
});

const shadowingSchema = z.object({
  sessionId: z.string().min(1),
  difficulty: z.enum(["easy", "normal", "hard"]).default("normal"),
  voice: z.string().min(1).optional(),
  provider: providerSchema.optional()
});

const audioTurnSchema = z.object({
  sessionId: z.string().min(1),
  audioBase64: z.string().min(16),
  mimeType: z.string().min(3).default("audio/webm"),
  languageHint: z.enum(["ja", "en", "mixed"]).optional(),
  mode: modeSchema.optional(),
  voice: z.string().min(1).optional(),
  provider: providerSchema.optional()
});

const audioUploadQuerySchema = z.object({
  sessionId: z.string().min(1),
  mimeType: z.string().min(3).default("audio/webm"),
  languageHint: z.enum(["ja", "en", "mixed"]).optional(),
  mode: modeSchema.optional(),
  voice: z.string().min(1).optional(),
  provider: providerSchema.optional()
});

interface ConversationTurnResult {
  mode: "discussion" | "help_ja";
  reply: string;
  followUpQuestion?: string;
  expressionHint?: {
    ja: string;
    en: string;
    examples: string[];
  };
  provider: "nemotron" | "gemini";
  model: string;
}

export function createSessionRouter(context: AppContext): Router {
  const router = Router();

  router.post("/api/session/message", async (req, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const session = context.store.getSession(parsed.data.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    let provider: LlmProvider;
    try {
      provider = resolveProvider(context, parsed.data.provider);
    } catch (error) {
      return res.status(403).json({ error: (error as Error).message });
    }

    try {
      const turn = await runConversationTurn({
        context,
        session,
        provider,
        mode: parsed.data.mode,
        userMessage: parsed.data.message
      });
      const speechResult = await synthesizeConversationSpeech(context, turn);
      return res.json({
        ...turn,
        speech: speechResult.speech,
        ttsError: speechResult.ttsError
      });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: "Unexpected error" });
    }
  });

  router.post("/api/session/audio-turn", async (req, res) => {
    const parsed = audioTurnSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const session = context.store.getSession(parsed.data.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    let provider: LlmProvider;
    try {
      provider = resolveProvider(context, parsed.data.provider);
    } catch (error) {
      return res.status(403).json({ error: (error as Error).message });
    }

    try {
      const result = await handleAudioTurn({
        context,
        session,
        provider,
        audioBase64: parsed.data.audioBase64,
        mimeType: parsed.data.mimeType,
        languageHint: parsed.data.languageHint,
        mode: parsed.data.mode,
        voice: parsed.data.voice
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(502).json({ error: error.message });
      }
      return res.status(502).json({ error: "Unexpected speech processing error" });
    }
  });

  router.post(
    "/api/session/audio-turn-upload",
    raw({
      type: "*/*",
      limit: `${context.env.JSON_BODY_LIMIT_MB}mb`
    }),
    async (req, res) => {
      const parsed = audioUploadQuerySchema.safeParse({
        sessionId: getOptionalString(req.query.sessionId),
        mimeType:
          getOptionalString(req.query.mimeType) ??
          (typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined),
        languageHint: getOptionalString(req.query.languageHint),
        mode: getOptionalString(req.query.mode),
        voice: getOptionalString(req.query.voice),
        provider: getOptionalString(req.query.provider)
      });

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const session = context.store.getSession(parsed.data.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found or expired" });
      }

      const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (audioBuffer.length < 16) {
        return res.status(400).json({ error: "Audio payload is too short" });
      }

      let provider: LlmProvider;
      try {
        provider = resolveProvider(context, parsed.data.provider);
      } catch (error) {
        return res.status(403).json({ error: (error as Error).message });
      }

      try {
        const result = await handleAudioTurn({
          context,
          session,
          provider,
          audioBase64: audioBuffer.toString("base64"),
          mimeType: parsed.data.mimeType,
          languageHint: parsed.data.languageHint,
          mode: parsed.data.mode,
          voice: parsed.data.voice
        });
        return res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          return res.status(502).json({ error: error.message });
        }
        return res.status(502).json({ error: "Unexpected speech processing error" });
      }
    }
  );

  router.post("/api/session/shadowing", async (req, res) => {
    const parsed = shadowingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const session = context.store.getSession(parsed.data.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }

    let provider: LlmProvider;
    try {
      provider = resolveProvider(context, parsed.data.provider);
    } catch (error) {
      return res.status(403).json({ error: (error as Error).message });
    }

    try {
      const client = context.createClient(provider);
      const shadowing = await generateShadowingScript(client, session, parsed.data.difficulty);
      context.store.appendMessage(session.sessionId, {
        role: "assistant",
        text: shadowing.script.join(" "),
        mode: "shadowing"
      });

      const shadowingSpeech = await synthesizeShadowingSpeech(context, shadowing.script, parsed.data.voice);

      return res.json({
        mode: "shadowing",
        script: shadowing.script,
        focusWords: shadowing.focusWords,
        provider: shadowing.provider,
        model: shadowing.model,
        speech: shadowingSpeech.speech,
        ttsError: shadowingSpeech.ttsError
      });
    } catch (error) {
      if (error instanceof ShadowingGenerationError) {
        return res.status(422).json({ error: error.message });
      }
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: "Unexpected error" });
    }
  });

  return router;
}

async function runConversationTurn(input: {
  context: AppContext;
  session: TrainingSession;
  provider: LlmProvider;
  mode: "discussion" | "help_ja";
  userMessage: string;
  inputLanguage?: SpeechLanguage;
}): Promise<ConversationTurnResult> {
  const { context, session, provider, mode, userMessage, inputLanguage } = input;
  context.store.appendMessage(session.sessionId, {
    role: "user",
    text: userMessage,
    mode
  });

  const client = context.createClient(provider);
  if (mode === "help_ja") {
    const help = await generateHelpJaReply(client, session, userMessage);
    context.store.appendMessage(session.sessionId, {
      role: "assistant",
      text: help.reply,
      mode: "help_ja"
    });
    return {
      mode: "help_ja",
      reply: help.reply,
      expressionHint: help.expressionHint,
      provider: help.provider,
      model: help.model
    };
  }

  const discussion = await generateDiscussionReply(
    client,
    session,
    userMessage,
    normalizeDiscussionInputLanguage(inputLanguage ?? detectMessageLanguage(userMessage))
  );
  const reformulated = toSentence(discussion.reformulatedLearnerMessage);
  const prefix =
    discussion.inputLanguage === "ja" || discussion.inputLanguage === "mixed"
      ? `In English, you could say: "${reformulated}"`
      : `A more natural way to say that is: "${reformulated}"`;
  const composedReply = `${prefix} ${discussion.reply}`.trim();
  context.store.appendMessage(session.sessionId, {
    role: "assistant",
    text: composedReply,
    mode: "discussion"
  });
  return {
    mode: "discussion",
    reply: composedReply,
    followUpQuestion: discussion.followUpQuestion,
    provider: discussion.provider,
    model: discussion.model
  };
}

function inferModeFromLanguage(language: SpeechLanguage, transcript: string): "discussion" | "help_ja" {
  if (hasJapaneseHelpIntent(transcript)) {
    return "help_ja";
  }
  return "discussion";
}

function hasJapaneseScript(text: string): boolean {
  return /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
}

function hasJapaneseHelpIntent(transcript: string): boolean {
  const normalized = transcript.toLowerCase();
  if (
    /(?:日本語で|日本語\s*を|英語で|訳して|翻訳して|教えて|説明して|言い方|どう言|表現)/.test(transcript)
  ) {
    return true;
  }

  if (/(?:\bnihon\s*go\b|\bnippon\s*go\b|\bnihongo\b|\bnihongo\s+de\b)/.test(normalized)) {
    return true;
  }

  if (
    /(?:\bin\s+japanese\b|\bjapanese\s+please\b|\bspeak\s+(?:in\s+)?japanese\b|\banswer\s+in\s+japanese\b|\bexplain\s+in\s+japanese\b)/.test(
      normalized
    )
  ) {
    return true;
  }

  return /\bjapanese\b/.test(normalized) && /\b(speak|answer|explain|teach|translate|use|please)\b/.test(normalized);
}

function resolveTtsLanguage(language: SpeechLanguage, turn: ConversationTurnResult): "ja" | "en" {
  const speechText = composeSpeechText(turn);
  if (hasJapaneseScript(speechText)) {
    return "ja";
  }
  if (turn.mode === "help_ja" && (language === "ja" || language === "mixed")) {
    return "ja";
  }
  return "en";
}

function composeSpeechText(turn: ConversationTurnResult): string {
  if (turn.mode === "discussion" && turn.followUpQuestion) {
    return `${turn.reply} ${turn.followUpQuestion}`;
  }
  if (turn.mode === "help_ja" && turn.expressionHint) {
    const helpSegments = [turn.reply, turn.expressionHint.ja, turn.expressionHint.en]
      .map((line) => line?.trim())
      .filter((line): line is string => Boolean(line));
    const examples = turn.expressionHint.examples
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return [...helpSegments, ...examples].join(" ");
  }
  return turn.reply;
}

async function synthesizeConversationSpeech(
  context: AppContext,
  turn: ConversationTurnResult,
  options?: {
    language?: "ja" | "en";
    voice?: string;
  }
): Promise<{ speech: TtsSynthesisResult | null; ttsError: string | null }> {
  try {
    const speech = await context.ttsClient.synthesize({
      text: composeSpeechText(turn),
      language: options?.language ?? inferLanguageFromTurn(turn),
      voice: options?.voice
    });
    return { speech, ttsError: null };
  } catch (error) {
    return {
      speech: null,
      ttsError: error instanceof Error ? error.message : String(error)
    };
  }
}

async function synthesizeShadowingSpeech(
  context: AppContext,
  script: string[],
  voice: string | undefined
): Promise<{ speech: TtsSynthesisResult | null; ttsError: string | null }> {
  const cleaned = script.map((line) => line.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return { speech: null, ttsError: null };
  }

  const joined = cleaned
    .map((line) => line.replace(/\s+/g, " ").replace(/[.?!]$/, ""))
    .join(". ")
    .concat(".");

  try {
    const speech = await context.ttsClient.synthesize({
      text: joined,
      language: "en",
      voice
    });
    return { speech, ttsError: null };
  } catch (error) {
    return {
      speech: null,
      ttsError: error instanceof Error ? error.message : String(error)
    };
  }
}

function inferLanguageFromTurn(turn: ConversationTurnResult): "ja" | "en" {
  if (hasJapaneseScript(composeSpeechText(turn))) {
    return "ja";
  }
  return "en";
}

async function handleAudioTurn(input: {
  context: AppContext;
  session: TrainingSession;
  provider: LlmProvider;
  audioBase64: string;
  mimeType: string;
  languageHint?: "ja" | "en" | "mixed";
  mode?: "discussion" | "help_ja";
  voice?: string;
}): Promise<{
  transcript: {
    text: string;
    language: SpeechLanguage;
    route: "ja" | "en" | "mixed";
    languageConfidence: { ja: number; en: number };
  };
  assistant: ConversationTurnResult;
  speech: TtsSynthesisResult | null;
  ttsError: string | null;
}> {
  const transcript = await input.context.asrClient.transcribeWithRouting({
    audioBase64: input.audioBase64,
    mimeType: input.mimeType,
    languageHint: input.languageHint
  });
  const mode = input.mode ?? inferModeFromLanguage(transcript.language, transcript.text);
  const turn = await runConversationTurn({
    context: input.context,
    session: input.session,
    provider: input.provider,
    mode,
    userMessage: transcript.text,
    inputLanguage: transcript.language
  });
  const speechResult = await synthesizeConversationSpeech(input.context, turn, {
    language: resolveTtsLanguage(transcript.language, turn),
    voice: input.voice
  });

  return {
    transcript: {
      text: transcript.text,
      language: transcript.language,
      route: transcript.route,
      languageConfidence: transcript.languageConfidence
    },
    assistant: turn,
    speech: speechResult.speech,
    ttsError: speechResult.ttsError
  };
}

function detectMessageLanguage(text: string): SpeechLanguage {
  const hasJa = hasJapaneseScript(text);
  const hasEn = /[A-Za-z]/.test(text);
  if (hasJa && hasEn) {
    return "mixed";
  }
  if (hasJa) {
    return "ja";
  }
  if (hasEn) {
    return "en";
  }
  return "unknown";
}

function normalizeDiscussionInputLanguage(language: SpeechLanguage): "ja" | "en" | "mixed" | "unknown" {
  if (language === "ja" || language === "en" || language === "mixed") {
    return language;
  }
  return "unknown";
}

function toSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
  if (!normalized) {
    return "I want to say this in a more natural way.";
  }
  return `${normalized}.`;
}

function getOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    const trimmed = value[0].trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}
