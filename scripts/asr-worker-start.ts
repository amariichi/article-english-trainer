import dotenv from "dotenv";
import { execa } from "execa";

dotenv.config();

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function getExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if (!("exitCode" in error)) {
    return undefined;
  }
  const value = (error as { exitCode?: unknown }).exitCode;
  return typeof value === "number" ? value : undefined;
}

function getSignal(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if (!("signal" in error)) {
    return undefined;
  }
  const value = (error as { signal?: unknown }).signal;
  return typeof value === "string" ? value : undefined;
}

function isDualCudaMode(env: NodeJS.ProcessEnv): boolean {
  const device = (env.ASR_DEVICE ?? "").trim().toLowerCase();
  const singleModelCache = parseBool(env.ASR_SINGLE_MODEL_CACHE, true);
  return device === "cuda" && !singleModelCache;
}

async function main(): Promise<void> {
  const device = process.env.ASR_DEVICE?.trim() || "(unset; asr-worker default=cpu)";
  const singleModelCache = process.env.ASR_SINGLE_MODEL_CACHE?.trim() || "(unset; default=true)";
  const preloadModels = process.env.ASR_PRELOAD_MODELS?.trim() || "(unset; default=false)";
  const enableCudaFallback = parseBool(process.env.ASR_ENABLE_CUDA_FALLBACK, true);
  console.log(
    `[asr-worker:start] launching with ASR_DEVICE=${device}, ASR_SINGLE_MODEL_CACHE=${singleModelCache}, ASR_PRELOAD_MODELS=${preloadModels}, ASR_ENABLE_CUDA_FALLBACK=${enableCudaFallback}`
  );

  const baseEnv: NodeJS.ProcessEnv = { ...process.env };
  let runtimeEnv: NodeJS.ProcessEnv = { ...baseEnv };
  let fallbackApplied = false;

  while (true) {
    try {
      await execa("uv", ["run", "--project", "asr-worker", "asr-worker"], {
        stdio: "inherit",
        env: runtimeEnv
      });
      return;
    } catch (error) {
      const exitCode = getExitCode(error);
      const signal = getSignal(error);

      const canFallback =
        enableCudaFallback && !fallbackApplied && isDualCudaMode(runtimeEnv) && (exitCode === 134 || exitCode === 139);

      if (canFallback) {
        fallbackApplied = true;
        runtimeEnv = {
          ...baseEnv,
          ASR_SINGLE_MODEL_CACHE: "true",
          ASR_PRELOAD_MODELS: "false"
        };
        console.error(
          `[asr-worker:start] detected ASR worker crash (exit=${exitCode ?? "unknown"}, signal=${signal ?? "none"}). ` +
            "Retrying once with ASR_SINGLE_MODEL_CACHE=true and ASR_PRELOAD_MODELS=false for CUDA stability."
        );
        continue;
      }

      throw error;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[asr-worker:start] failed: ${message}`);
  process.exit(1);
});
