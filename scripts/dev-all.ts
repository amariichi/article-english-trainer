import { type ChildProcess,spawn } from "node:child_process";
import net from "node:net";

import dotenv from "dotenv";

dotenv.config();

type Target = {
  name: string;
  args: string[];
};

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Map<string, ChildProcess>();
let shuttingDown = false;
let finalExitCode = 0;
const isWindows = process.platform === "win32";

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev:all] Failed to start: ${message}`);
  process.exit(1);
});

async function main(): Promise<void> {
  const appPort = parsePort(process.env.PORT, 3000);
  await assertPortAvailable(appPort);

  const targets = buildTargets(process.env);

  console.log("[dev:all] Starting local services (Nemotron/ASR/TTS/app as configured). Press Ctrl+C to stop all.");
  console.log(`[dev:all] env: ASR_DEVICE=${process.env.ASR_DEVICE ?? "(unset)"}`);
  console.log(`[dev:all] env: TTS_BACKEND=${process.env.TTS_BACKEND ?? "(unset)"}`);
  console.log(`[dev:all] targets=${targets.map((target) => target.name).join(", ")}`);

  process.on("SIGINT", () => {
    requestShutdown("SIGINT", 130);
  });

  process.on("SIGTERM", () => {
    requestShutdown("SIGTERM", 143);
  });

  for (const target of targets) {
    launch(target);
  }
}

function buildTargets(env: NodeJS.ProcessEnv): Target[] {
  const targets: Target[] = [
    { name: "nemotron", args: ["run", "nemotron:serve"] },
    { name: "asr", args: ["run", "asr-worker:start"] }
  ];

  if (shouldStartLocalTtsWorker(env)) {
    targets.push({ name: "tts", args: ["run", "tts-worker:start"] });
  }

  targets.push({ name: "app", args: ["run", "dev"] });
  return targets;
}

function shouldStartLocalTtsWorker(env: NodeJS.ProcessEnv): boolean {
  const backend = (env.TTS_BACKEND ?? "").trim().toLowerCase();
  if (backend !== "http_audio") {
    return false;
  }

  const endpoint = env.TTS_ENDPOINT_URL?.trim();
  if (!endpoint) {
    return true;
  }

  try {
    const parsed = new URL(endpoint);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function launch(target: Target): void {
  const child = spawn(npmBin, target.args, {
    stdio: "inherit",
    env: process.env,
    detached: !isWindows
  });
  children.set(target.name, child);

  child.on("exit", (code, signal) => {
    children.delete(target.name);

    if (shuttingDown) {
      if (typeof code === "number" && code !== 0 && finalExitCode === 0) {
        finalExitCode = code;
      }
      if (children.size === 0) {
        process.exit(finalExitCode);
      }
      return;
    }

    shuttingDown = true;
    finalExitCode = typeof code === "number" ? code : signal ? 1 : 0;
    const reason = typeof code === "number" ? `code ${code}` : `signal ${signal ?? "unknown"}`;
    console.error(`[dev:all] ${target.name} exited with ${reason}. Stopping remaining processes...`);
    stopChildren();
    if (children.size === 0) {
      process.exit(finalExitCode);
    }
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    finalExitCode = 1;
    console.error(`[dev:all] Failed to start ${target.name}: ${error.message}`);
    stopChildren();
    if (children.size === 0) {
      process.exit(finalExitCode);
    }
  });
}

function requestShutdown(signal: NodeJS.Signals, exitCode: number): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  finalExitCode = exitCode;
  console.log(`[dev:all] Received ${signal}. Stopping app + nemotron + asr...`);
  stopChildren();
  if (children.size === 0) {
    process.exit(finalExitCode);
  }
}

function stopChildren(): void {
  for (const child of children.values()) {
    terminateTree(child, "SIGTERM");
  }

  setTimeout(() => {
    for (const child of children.values()) {
      terminateTree(child, "SIGKILL");
    }
  }, 5000).unref();
}

function terminateTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (!isWindows && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch {
    // Ignore process termination races.
  }
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `PORT ${port} is already in use. Stop the existing app process first, then retry npm run dev:all.`
          )
        );
        return;
      }
      reject(error);
    });

    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });

    server.listen(port, "0.0.0.0");
  });
}
