import type { AppEnv } from "../config/env.js";
import { GeminiClient } from "./providers/gemini.js";
import { NemotronClient } from "./providers/nemotron.js";
import type { LlmClient, LlmProvider } from "./types.js";

export function createLlmClient(provider: LlmProvider, env: AppEnv): LlmClient {
  if (provider === "nemotron") {
    return new NemotronClient(env);
  }
  return new GeminiClient(env);
}
