import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";

describe("loadEnv", () => {
  it("loads defaults", () => {
    const env = loadEnv({});
    expect(env.LLM_PROVIDER).toBe("nemotron");
    expect(env.ALLOW_PROVIDER_OVERRIDE).toBe(false);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.PORT).toBe(3000);
    expect(env.ARTICLE_REACHABILITY_TIMEOUT_MS).toBe(3000);
    expect(env.AGENT_BROWSER_COMMAND_TIMEOUT_MS).toBe(10000);
    expect(env.AGENT_BROWSER_WAIT_NETWORKIDLE_TIMEOUT_MS).toBe(3000);
    expect(env.MIC_MAX_RECORDING_MS).toBe(35000);
    expect(env.ASR_SKIP_FAST_WHEN_HINTED).toBe(true);
    expect(env.ASR_SKIP_REDUNDANT_DECODE).toBe(true);
    expect(env.TTS_BACKEND).toBe("http_audio");
    expect(env.TTS_ENDPOINT_URL).toBeUndefined();
  });

  it("rejects unsupported provider", () => {
    expect(() => loadEnv({ LLM_PROVIDER: "gpt-oss-20b" })).toThrow();
  });

  it("parses boolean override flag", () => {
    const env = loadEnv({ ALLOW_PROVIDER_OVERRIDE: "true" });
    expect(env.ALLOW_PROVIDER_OVERRIDE).toBe(true);
  });

  it("treats empty optional URLs as unset", () => {
    const env = loadEnv({
      TTS_BACKEND: "minimum_headroom_face_say",
      TTS_ENDPOINT_URL: "",
      ASR_FAST_URL: ""
    });
    expect(env.TTS_ENDPOINT_URL).toBeUndefined();
    expect(env.ASR_FAST_URL).toBeUndefined();
  });
});
