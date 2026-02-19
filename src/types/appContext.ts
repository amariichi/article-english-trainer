import type { ArticleDocument } from "../article/articleExtractor.js";
import type { AppEnv } from "../config/env.js";
import type { LlmClient, LlmProvider } from "../llm/types.js";
import type { TrainingSessionStore } from "../session/trainingSessionStore.js";
import type { AsrClient, TtsClient } from "../speech/types.js";

export interface AppContext {
  env: AppEnv;
  store: TrainingSessionStore;
  createClient: (provider: LlmProvider) => LlmClient;
  asrClient: AsrClient;
  ttsClient: TtsClient;
  fetchArticle: (url: string) => Promise<ArticleDocument>;
}
