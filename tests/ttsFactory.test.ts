import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";
import { createTtsClient } from "../src/speech/ttsFactory.js";

describe("createTtsClient", () => {
  it("creates minimum_headroom_face_say client when configured", () => {
    const env = loadEnv({
      TTS_BACKEND: "minimum_headroom_face_say"
    });
    const client = createTtsClient(env);
    expect(client.constructor.name).toBe("MinimumHeadroomFaceSayClient");
  });

  it("creates http audio client when configured", () => {
    const env = loadEnv({
      TTS_BACKEND: "http_audio",
      TTS_ENDPOINT_URL: "http://127.0.0.1:9002/v1/tts"
    });
    const client = createTtsClient(env);
    expect(client.constructor.name).toBe("HttpTtsClient");
  });

  it("returns null with disabled backend", async () => {
    const env = loadEnv({
      TTS_BACKEND: "disabled"
    });
    const client = createTtsClient(env);
    const result = await client.synthesize({
      text: "hello",
      language: "en"
    });
    expect(result).toBeNull();
  });
});
