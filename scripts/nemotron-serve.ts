import { access } from "node:fs/promises";

import dotenv from "dotenv";
import { execa } from "execa";

const DEFAULT_SERVER_BIN = "llama-server";
dotenv.config();

async function main(): Promise<void> {
  const serverBin = process.env.NEMOTRON_LLAMA_SERVER_BIN?.trim() || DEFAULT_SERVER_BIN;
  const model = requireEnv("NEMOTRON_GGUF_PATH");
  await assertFileExists("NEMOTRON_GGUF_PATH", model);
  const servedModelName = process.env.NEMOTRON_MODEL_ID?.trim() || "nemotron-3-nano";
  const host = process.env.NEMOTRON_HOST?.trim() || "127.0.0.1";
  const port = process.env.NEMOTRON_PORT?.trim() || "8000";
  const maxModelLen = process.env.NEMOTRON_MAX_MODEL_LEN?.trim() || "2048";
  const nGpuLayers = process.env.NEMOTRON_N_GPU_LAYERS?.trim() || "-1";
  const threads = process.env.NEMOTRON_THREADS?.trim();

  const args = [
    "--model",
    model,
    "--alias",
    servedModelName,
    "--host",
    host,
    "--port",
    port,
    "--ctx-size",
    maxModelLen,
    "--n-gpu-layers",
    nGpuLayers
  ];

  if (threads) {
    args.push("--threads", threads);
  }

  console.log("[nemotron:serve] launching local llama.cpp server");
  console.log(`  binary: ${serverBin}`);
  console.log(`  model: ${model}`);
  console.log(`  alias: ${servedModelName}`);
  console.log(`  endpoint: http://${host}:${port}/v1`);
  console.log(`  n-gpu-layers: ${nGpuLayers}`);
  if (threads) {
    console.log(`  threads: ${threads}`);
  }
  console.log("  note: model must be a GGUF file compatible with llama.cpp.");

  await execa(serverBin, args, {
    stdio: "inherit",
    env: process.env
  });
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for local llama.cpp runtime`);
  }
  return value;
}

async function assertFileExists(name: string, filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${name} does not point to an existing file: ${filePath}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`nemotron:serve failed: ${message}`);
  process.exit(1);
});
