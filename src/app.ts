import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";

import { fetchArticle as fetchArticleFromUrl } from "./article/articleExtractor.js";
import { type AppEnv,loadEnv } from "./config/env.js";
import { createLlmClient } from "./llm/factory.js";
import type { LlmClient, LlmProvider } from "./llm/types.js";
import { createArticleRouter } from "./routes/article.js";
import { createConfigRouter } from "./routes/config.js";
import { createHealthRouter } from "./routes/health.js";
import { createSessionRouter } from "./routes/session.js";
import { TrainingSessionStore } from "./session/trainingSessionStore.js";
import { HttpAsrClient } from "./speech/httpAsrClient.js";
import { createTtsClient } from "./speech/ttsFactory.js";
import type { AsrClient, TtsClient } from "./speech/types.js";
import type { AppContext } from "./types/appContext.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateAppDependencies {
  env?: AppEnv;
  store?: TrainingSessionStore;
  createClient?: (provider: LlmProvider) => LlmClient;
  asrClient?: AsrClient;
  ttsClient?: TtsClient;
  fetchArticle?: (url: string) => ReturnType<AppContext["fetchArticle"]>;
}

export function createApp(deps: CreateAppDependencies = {}): Express {
  const env = deps.env ?? loadEnv();
  const store = deps.store ?? new TrainingSessionStore();
  const createClient = deps.createClient ?? ((provider: LlmProvider) => createLlmClient(provider, env));
  const asrClient = deps.asrClient ?? new HttpAsrClient(env);
  const ttsClient = deps.ttsClient ?? createTtsClient(env);
  const fetchArticle = deps.fetchArticle ?? ((url: string) => fetchArticleFromUrl(url, env));

  const context: AppContext = {
    env,
    store,
    createClient,
    asrClient,
    ttsClient,
    fetchArticle
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: `${env.JSON_BODY_LIMIT_MB}mb` }));

  const publicDir = path.resolve(__dirname, "../public");
  app.use(express.static(publicDir));

  app.use(createHealthRouter());
  app.use(createConfigRouter(context));
  app.use(createArticleRouter(context));
  app.use(createSessionRouter(context));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
