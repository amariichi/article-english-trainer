import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) {
      return false;
    }
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

function booleanWithDefaultFromEnv(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    }
    return defaultValue;
  }, z.boolean());
}

const optionalUrlFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().url().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  JSON_BODY_LIMIT_MB: z.coerce.number().int().positive().default(16),
  LLM_PROVIDER: z.enum(["nemotron", "gemini"]).default("nemotron"),
  ALLOW_PROVIDER_OVERRIDE: booleanFromEnv,
  NEMOTRON_RUNTIME: z
    .enum(["local_llama_cpp", "local_vllm", "remote_api"])
    .default("local_llama_cpp"),
  NEMOTRON_API_KEY: z.string().optional(),
  NEMOTRON_BASE_URL: z.string().url().default("http://127.0.0.1:8000/v1"),
  NEMOTRON_MODEL_ID: z.string().default("nemotron-3-nano"),
  GEMINI_MODEL_ID: z.string().optional(),
  ASR_FAST_URL: optionalUrlFromEnv,
  ASR_JA_URL: optionalUrlFromEnv,
  ASR_EN_URL: optionalUrlFromEnv,
  ASR_MIXED_URL: optionalUrlFromEnv,
  ASR_MODEL_FAST: z.string().default("nvidia/parakeet-tdt-0.6b-v2"),
  ASR_MODEL_JA: z.string().default("nvidia/parakeet-tdt_ctc-0.6b-ja"),
  ASR_MODEL_EN: z.string().default("nvidia/parakeet-tdt-0.6b-v2"),
  ASR_MODEL_MIXED: z.string().default("nvidia/parakeet-tdt-0.6b-v2"),
  ASR_LANGUAGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  ASR_SKIP_FAST_WHEN_HINTED: booleanWithDefaultFromEnv(true),
  ASR_SKIP_REDUNDANT_DECODE: booleanWithDefaultFromEnv(true),
  MIC_MAX_RECORDING_MS: z.coerce.number().int().positive().default(35000),
  ASR_FAST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  ASR_DECODE_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  TTS_BACKEND: z
    .enum(["disabled", "http_audio", "minimum_headroom_face_say"])
    .default("http_audio"),
  TTS_ENDPOINT_URL: optionalUrlFromEnv,
  TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  TTS_DEFAULT_VOICE: z.string().default("af_heart"),
  MINIMUM_HEADROOM_WS_URL: z.string().url().default("ws://127.0.0.1:8765/ws"),
  MINIMUM_HEADROOM_SESSION_ID: z.string().default("english-trainer"),
  MINIMUM_HEADROOM_SAY_PRIORITY: z.coerce.number().int().min(0).max(3).default(2),
  MINIMUM_HEADROOM_SAY_POLICY: z.enum(["replace", "interrupt"]).default("replace"),
  MINIMUM_HEADROOM_SAY_TTL_MS: z.coerce.number().int().positive().default(60000),
  MINIMUM_HEADROOM_SAY_TIMEOUT_MS: z.coerce.number().int().positive().default(700),
  AGENT_BROWSER_SESSION: z.string().default("article-main"),
  AGENT_BROWSER_STATE_PATH: z.string().default(".local/article-auth-state.json"),
  AGENT_BROWSER_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  AGENT_BROWSER_WAIT_NETWORKIDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ARTICLE_REACHABILITY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ARTICLE_MIN_CHARS: z.coerce.number().int().positive().default(1200)
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}
