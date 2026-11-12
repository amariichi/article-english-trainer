import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";

import type { AppEnv } from "../../config/env.js";
import type { GenerateTextInput, GenerateTextResult, LlmClient } from "../types.js";

// Keep the provider ID for existing clients and saved sessions; execution uses agy.
export class GeminiClient implements LlmClient {
  constructor(private readonly env: AppEnv) {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const cwd = await mkdtemp(join(tmpdir(), "english-trainer-agy-"));
    try {
      const { stdout } = await execa("agy", [
        "--model", this.env.AGY_MODEL_ID,
        "--output-format", "text",
        "--disable-slash-commands",
        "--sandbox",
        "--print-timeout", "120s"
      ], {
        input: buildPrompt(input),
        cwd,
        reject: true,
        timeout: 130_000,
        env: process.env
      });
      const text = stdout.trim();
      if (!text) {
        throw new Error("agy returned no text");
      }
      return { provider: "gemini", model: this.env.AGY_MODEL_ID, text };
    } catch {
      // CLI errors may contain prompt/context text. Do not expose them to clients.
      throw new Error("agy generation failed. Check agy authentication, model availability and CLI installation.");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}

function buildPrompt(input: GenerateTextInput): string {
  return [
    "Return only the requested text. Do not use tools, access files, or execute commands.",
    input.systemPrompt ? `System:\n${input.systemPrompt}` : null,
    input.context ? `Context:\n${input.context}` : null,
    `Task:\n${input.prompt}`,
    input.temperature !== undefined ? `Temperature hint: ${input.temperature}` : null
  ].filter((entry): entry is string => Boolean(entry)).join("\n\n");
}
