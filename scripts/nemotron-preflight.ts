import { access } from "node:fs/promises";

import dotenv from "dotenv";
import { execa } from "execa";

const DEFAULT_SERVER_BIN = "llama-server";
dotenv.config();

async function main(): Promise<void> {
  let hasError = false;
  const serverBin = process.env.NEMOTRON_LLAMA_SERVER_BIN?.trim() || DEFAULT_SERVER_BIN;
  const modelPath = process.env.NEMOTRON_GGUF_PATH?.trim();

  console.log("[check] GPU info via nvidia-smi");
  try {
    const { stdout } = await execa("nvidia-smi", [
      "--query-gpu=name,memory.total,driver_version",
      "--format=csv,noheader"
    ]);
    console.log(`  ok: ${stdout}`);
  } catch (error) {
    hasError = true;
    console.log(`  fail: ${formatError(error)}`);
  }

  console.log("[check] llama.cpp server binary");
  try {
    await execa(serverBin, ["--help"]);
    console.log(`  ok: ${serverBin} is runnable`);
  } catch (error) {
    hasError = true;
    console.log(`  fail: ${formatError(error)}`);
  }

  console.log("[check] local GGUF model path");
  if (!modelPath) {
    hasError = true;
    console.log("  fail: NEMOTRON_GGUF_PATH is not set");
  } else {
    try {
      await access(modelPath);
      console.log(`  ok: ${modelPath}`);
    } catch {
      hasError = true;
      console.log(`  fail: file not found (${modelPath})`);
    }
  }

  console.log("[check] local llama.cpp endpoint");
  try {
    const { stdout } = await execa("curl", ["-sS", "http://127.0.0.1:8000/v1/models"]);
    const compact = stdout.replace(/\s+/g, " ").slice(0, 180);
    console.log(`  ok: ${compact}`);
  } catch {
    hasError = true;
    console.log("  fail: http://127.0.0.1:8000/v1/models is not reachable yet");
  }

  if (hasError) {
    console.log("\nPreflight result: NOT READY");
    console.log(
      "Expected setup: NVIDIA driver + llama-server binary + valid NEMOTRON_GGUF_PATH + running local endpoint (http://127.0.0.1:8000/v1)."
    );
    process.exit(1);
  }

  console.log("\nPreflight result: READY");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

main().catch((error) => {
  console.error(`preflight crashed: ${formatError(error)}`);
  process.exit(1);
});
