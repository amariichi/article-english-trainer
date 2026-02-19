import type { AppEnv } from "../config/env.js";
import { HttpTtsClient } from "./httpTtsClient.js";
import { MinimumHeadroomFaceSayClient } from "./minimumHeadroomFaceSayClient.js";
import type { TtsClient } from "./types.js";

class NoopTtsClient implements TtsClient {
  async synthesize(): Promise<null> {
    return null;
  }
}

export function createTtsClient(env: AppEnv): TtsClient {
  if (env.TTS_BACKEND === "disabled") {
    return new NoopTtsClient();
  }
  if (env.TTS_BACKEND === "http_audio") {
    return new HttpTtsClient(env);
  }
  return new MinimumHeadroomFaceSayClient(env);
}
