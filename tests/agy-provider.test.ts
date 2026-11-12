import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";

import { loadEnv } from "../src/config/env.js";
import { GeminiClient } from "../src/llm/providers/gemini.js";

vi.mock("execa", () => ({ execa: vi.fn() }));

describe("agy-backed Gemini provider", () => {
  it("keeps Nemotron default and uses Hydrogen low only for the alternate provider", async () => {
    const env = loadEnv({});
    expect(env.LLM_PROVIDER).toBe("nemotron");
    expect(env.AGY_MODEL_ID).toBe("gemini-4-hydrogen-low");
    vi.mocked(execa).mockResolvedValueOnce({ stdout: " Hello. \n" } as never);
    const result = await new GeminiClient(env).generateText({ prompt: "A fictional exercise" });
    expect(result).toEqual({ provider: "gemini", model: "gemini-4-hydrogen-low", text: "Hello." });
    const [command, args, options] = vi.mocked(execa).mock.calls.at(-1)! as unknown as [string, string[], Record<string, unknown>];
    expect(command).toBe("agy");
    expect(args).toContain("gemini-4-hydrogen-low");
    expect(args).toContain("--sandbox");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--continue");
    expect(options).toMatchObject({ input: expect.stringContaining("A fictional exercise"), timeout: 130_000 });
  });

  it("does not return CLI errors containing article data", async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error("private article text"));
    await expect(new GeminiClient(loadEnv({})).generateText({ prompt: "example" }))
      .rejects.toThrow("agy generation failed.");
  });

  it("rejects empty output rather than accepting it as a lesson", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ stdout: "  " } as never);
    await expect(new GeminiClient(loadEnv({})).generateText({ prompt: "example" }))
      .rejects.toThrow("agy generation failed.");
  });
});
