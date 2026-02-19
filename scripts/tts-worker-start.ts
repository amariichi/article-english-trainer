import dotenv from "dotenv";
import { execa } from "execa";

dotenv.config();

function selectedEndpoint(): string {
  const configured = process.env.TTS_ENDPOINT_URL?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  return "http://127.0.0.1:8092/v1/tts";
}

async function main(): Promise<void> {
  console.log(
    `[tts-worker:start] launching with endpoint=${selectedEndpoint()}, ` +
      `voice=${process.env.TTS_DEFAULT_VOICE ?? "af_heart"}`
  );
  if (process.env.TTS_KOKORO_MODEL_PATH || process.env.TTS_KOKORO_VOICES_PATH) {
    console.log(
      `[tts-worker:start] model=${process.env.TTS_KOKORO_MODEL_PATH ?? "(auto)"} ` +
        `voices=${process.env.TTS_KOKORO_VOICES_PATH ?? "(auto)"}`
    );
  } else {
    console.log("[tts-worker:start] using auto model-path detection");
  }

  await execa("uv", ["run", "--project", "tts-worker", "tts-worker"], {
    stdio: "inherit",
    env: process.env
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[tts-worker:start] failed: ${message}`);
  process.exit(1);
});
