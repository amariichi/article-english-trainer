import { execa } from "execa";

import type { AppEnv } from "../../config/env.js";
import type { GenerateTextInput, GenerateTextResult, LlmClient } from "../types.js";

export class GeminiClient implements LlmClient {
  constructor(private readonly env: AppEnv) {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const args = ["-p", buildPrompt(input), "--output-format", "json"];
    if (this.env.GEMINI_MODEL_ID && this.env.GEMINI_MODEL_ID.trim().length > 0) {
      args.push("-m", this.env.GEMINI_MODEL_ID);
    }

    try {
      const { stdout } = await execa("gemini", args, {
        reject: true,
        env: process.env
      });

      const payload = parseJsonPayload(stdout);
      const text = payload.response?.trim();
      if (!text) {
        throw new Error("Gemini CLI response did not include text");
      }

      return {
        provider: "gemini",
        model: resolveModelName(payload, this.env.GEMINI_MODEL_ID),
        text
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("FatalAuthenticationError")) {
          throw new Error(
            'Gemini CLI is not authenticated. Run "gemini" in an interactive terminal and complete login.'
          );
        }
        throw new Error(`Gemini CLI call failed: ${error.message}`);
      }
      throw error;
    }
  }
}

interface GeminiCliPayload {
  response?: string;
  stats?: {
    models?: Record<string, unknown>;
  };
}

function buildPrompt(input: GenerateTextInput): string {
  const sections = [
    input.systemPrompt ? `System:\n${input.systemPrompt}` : null,
    input.context ? `Context:\n${input.context}` : null,
    `Task:\n${input.prompt}`,
    input.temperature !== undefined ? `Temperature hint: ${input.temperature}` : null
  ].filter((entry): entry is string => Boolean(entry));

  return sections.join("\n\n");
}

function parseJsonPayload(output: string): GeminiCliPayload {
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith("{")) {
      continue;
    }

    const candidate = lines.slice(i).join("\n").trim();
    try {
      return JSON.parse(candidate) as GeminiCliPayload;
    } catch {
      // Continue scanning if this line is not the JSON payload start.
    }
  }

  throw new Error("Gemini CLI output did not contain a valid JSON payload");
}

function resolveModelName(payload: GeminiCliPayload, configuredModel: string | undefined): string {
  const statModels = payload.stats?.models ? Object.keys(payload.stats.models) : [];
  if (statModels.length > 0) {
    return statModels[0];
  }
  if (configuredModel && configuredModel.trim().length > 0) {
    return configuredModel;
  }
  return "gemini-cli";
}
