import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEnv } from "../src/config/env.js";
import { HttpTtsClient } from "../src/speech/httpTtsClient.js";

describe("HttpTtsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips request when normalized text becomes empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const env = loadEnv({
      TTS_BACKEND: "http_audio",
      TTS_ENDPOINT_URL: "http://127.0.0.1:9002/v1/tts"
    });
    const client = new HttpTtsClient(env);
    const result = await client.synthesize({
      text: "。、、・・。。。",
      language: "ja"
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
