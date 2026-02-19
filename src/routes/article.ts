import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { ArticleExtractionError } from "../article/articleExtractor.js";
import { resolveProvider } from "../llm/providerPolicy.js";
import type { LlmProvider } from "../llm/types.js";
import { summarizeArticle } from "../session/trainingEngine.js";
import type { TtsSynthesisResult } from "../speech/types.js";
import type { AppContext } from "../types/appContext.js";

const providerSchema = z.enum(["nemotron", "gemini"]);

const fetchSchema = z.object({
  url: z.string().url(),
  provider: providerSchema.optional()
});

const manualSchema = z.object({
  title: z.string().min(3).max(300).optional(),
  text: z.string().min(300),
  sourceUrl: z.string().url().optional(),
  provider: providerSchema.optional()
});

export function createArticleRouter(context: AppContext): Router {
  const router = Router();

  async function handleFetch(req: Request, res: Response) {
    const parsed = fetchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    let provider: LlmProvider;
    try {
      provider = resolveProvider(context, parsed.data.provider);
    } catch (error) {
      return res.status(403).json({ error: (error as Error).message });
    }

    try {
      const article = await context.fetchArticle(parsed.data.url);
      const client = context.createClient(provider);
      const summary = await summarizeArticle(client, article.title, article.text);
      const session = context.store.createSession({
        articleTitle: article.title,
        articleText: article.text,
        summary: summary.short
      });
      const summarySpeech = await synthesizeSummarySpeech(context, summary.short, summary.discussionStarter);

      return res.json({
        sessionId: session.sessionId,
        article: {
          title: article.title,
          url: article.url
        },
        summary: {
          short: summary.short,
          bullets: summary.bullets,
          discussionStarter: summary.discussionStarter
        },
        provider: summary.provider,
        model: summary.model,
        speech: summarySpeech.speech,
        ttsError: summarySpeech.ttsError
      });
    } catch (error) {
      if (error instanceof ArticleExtractionError) {
        return res.status(502).json({
          error: error.message,
          manualFallbackRecommended: error.manualFallbackRecommended
        });
      }

      if (error instanceof Error) {
        return res.status(500).json({ error: error.message, manualFallbackRecommended: true });
      }

      return res.status(500).json({ error: "Unexpected error", manualFallbackRecommended: true });
    }
  }

  async function handleManual(req: Request, res: Response) {
    const parsed = manualSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    let provider: LlmProvider;
    try {
      provider = resolveProvider(context, parsed.data.provider);
    } catch (error) {
      return res.status(403).json({ error: (error as Error).message });
    }

    try {
      const client = context.createClient(provider);
      const articleTitle = parsed.data.title ?? "Manual Article Text";
      const summary = await summarizeArticle(client, articleTitle, parsed.data.text);
      const session = context.store.createSession({
        articleTitle,
        articleText: parsed.data.text,
        summary: summary.short
      });
      const summarySpeech = await synthesizeSummarySpeech(context, summary.short, summary.discussionStarter);

      return res.json({
        sessionId: session.sessionId,
        article: {
          title: articleTitle,
          url: parsed.data.sourceUrl ?? "manual://input"
        },
        summary: {
          short: summary.short,
          bullets: summary.bullets,
          discussionStarter: summary.discussionStarter
        },
        provider: summary.provider,
        model: summary.model,
        source: "manual",
        speech: summarySpeech.speech,
        ttsError: summarySpeech.ttsError
      });
    } catch (error) {
      if (error instanceof Error) {
        return res.status(500).json({ error: error.message });
      }
      return res.status(500).json({ error: "Unexpected error" });
    }
  }

  router.post("/api/article/fetch", handleFetch);
  router.post("/api/article/manual", handleManual);

  return router;
}

async function synthesizeSummarySpeech(
  context: AppContext,
  shortSummary: string,
  discussionStarter: string
): Promise<{ speech: TtsSynthesisResult | null; ttsError: string | null }> {
  try {
    const speech = await context.ttsClient.synthesize({
      text: `Article summary is ready. ${shortSummary} ${discussionStarter}`,
      language: "en",
      voice: context.env.TTS_DEFAULT_VOICE
    });
    return { speech, ttsError: null };
  } catch (error) {
    return {
      speech: null,
      ttsError: error instanceof Error ? error.message : String(error)
    };
  }
}
