import OpenAI from "openai";

import type { AppEnv } from "../../config/env.js";
import type { GenerateTextInput, GenerateTextResult, LlmClient } from "../types.js";

export class NemotronClient implements LlmClient {
  private readonly client: OpenAI;
  private readonly useLocalRuntime: boolean;

  constructor(private readonly env: AppEnv) {
    this.useLocalRuntime =
      env.NEMOTRON_RUNTIME === "local_llama_cpp" ||
      env.NEMOTRON_RUNTIME === "local_vllm" ||
      isLocalBaseUrl(env.NEMOTRON_BASE_URL);

    const apiKey = env.NEMOTRON_API_KEY ?? (this.useLocalRuntime ? "local-openai-compatible" : undefined);

    this.client = new OpenAI({
      apiKey: apiKey ?? "missing-api-key",
      baseURL: env.NEMOTRON_BASE_URL
    });
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    if (!this.useLocalRuntime && !this.env.NEMOTRON_API_KEY) {
      throw new Error("NEMOTRON_API_KEY is required for nemotron provider");
    }

    const userPrompt = input.context
      ? `Context:\n${input.context}\n\nTask:\n${input.prompt}`
      : input.prompt;

    try {
      const response = await this.client.chat.completions.create({
        model: this.env.NEMOTRON_MODEL_ID,
        temperature: input.temperature,
        messages: [
          ...(input.systemPrompt
            ? [
                {
                  role: "system" as const,
                  content: input.systemPrompt
                }
              ]
            : []),
          {
            role: "user" as const,
            content: userPrompt
          }
        ]
      });

      const text = response.choices[0]?.message?.content?.trim();
      if (!text) {
        throw new Error("Nemotron response did not include text content");
      }

      return {
        provider: "nemotron",
        model: this.env.NEMOTRON_MODEL_ID,
        text
      };
    } catch (error) {
      if (error instanceof OpenAI.APIConnectionError) {
        const detail = getConnectionErrorDetail(error);
        const suffix = detail ? ` Detail: ${detail}` : "";
        throw new Error(
          `Nemotron endpoint is unreachable (${this.env.NEMOTRON_BASE_URL}). Start local server with "npm run nemotron:serve" or switch provider to gemini.${suffix}`
        );
      }

      if (error instanceof Error) {
        throw new Error(`Nemotron request failed: ${error.message}`);
      }
      throw error;
    }
  }
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

function getConnectionErrorDetail(error: { cause?: unknown }): string | null {
  const cause = (error as { cause?: unknown }).cause;
  if (!cause) {
    return null;
  }
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (typeof cause === "string" && cause.trim().length > 0) {
    return cause;
  }
  return null;
}
