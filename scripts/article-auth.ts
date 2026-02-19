import { mkdir } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import { execa } from "execa";

import { loadEnv } from "../src/config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  await mkdir(path.dirname(env.AGENT_BROWSER_STATE_PATH), { recursive: true });

  await tryLaunch(env.AGENT_BROWSER_SESSION);
  console.log("Step 1: Opening site with headed browser. Please log in manually if needed.");
  await run(["--session", env.AGENT_BROWSER_SESSION, "--headed", "open", "https://www.economist.com"]);

  const rl = readline.createInterface({ input, output });
  await rl.question("After login (and 2FA if needed), press Enter to save auth state... ");
  rl.close();

  console.log(`Step 2: Saving auth state to ${env.AGENT_BROWSER_STATE_PATH}`);
  await run(["--session", env.AGENT_BROWSER_SESSION, "state", "save", env.AGENT_BROWSER_STATE_PATH]);
  console.log("Done. You can now run the app and fetch articles.");
}

async function tryLaunch(sessionName: string): Promise<void> {
  try {
    await run(["--session", sessionName, "launch"]);
  } catch {
    // Compatibility: older agent-browser versions may not expose launch command.
  }
}

async function run(args: string[]): Promise<void> {
  await execa("agent-browser", args, {
    stdio: "inherit",
    env: process.env
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`article:auth failed: ${message}`);
  process.exit(1);
});
