import { access } from "node:fs/promises";

import { execa } from "execa";

export interface AgentBrowserClient {
  extractArticle(url: string): Promise<{ title: string; text: string }>;
}

interface AgentBrowserClientOptions {
  sessionName: string;
  authStatePath: string;
  commandTimeoutMs: number;
  waitNetworkIdleTimeoutMs: number;
}

export class CliAgentBrowserClient implements AgentBrowserClient {
  constructor(private readonly options: AgentBrowserClientOptions) {}

  async extractArticle(url: string): Promise<{ title: string; text: string }> {
    await this.tryLaunch();

    const hasAuthState = await this.hasAuthState();
    if (hasAuthState) {
      await this.run(["state", "load", this.options.authStatePath]);
    }
    await this.run(["open", url]);
    await this.tryWaitForNetworkIdle();

    const rawTitle = await this.run(["get", "title"]);
    const rawText = await this.run([
      "eval",
      `(() => {
  const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const paragraphs = Array.from(root.querySelectorAll("p"))
    .map((node) => normalize(node.textContent))
    .filter((value) => value.length > 40);
  return paragraphs.join("\\n\\n");
})()`
    ]);

    const title = normalizeAgentOutput(rawTitle);
    const text = normalizeAgentOutput(rawText);
    return { title, text };
  }

  private async hasAuthState(): Promise<boolean> {
    try {
      await access(this.options.authStatePath);
      return true;
    } catch {
      return false;
    }
  }

  private async run(args: string[]): Promise<string> {
    try {
      return await this.runRaw(args, this.options.commandTimeoutMs);
    } catch (error) {
      if (isBrowserNotLaunchedError(error)) {
        await this.tryLaunch();
        try {
          return await this.runRaw(args, this.options.commandTimeoutMs);
        } catch (retryError) {
          throw this.wrapRunError(args, retryError);
        }
      }
      throw this.wrapRunError(args, error);
    }
  }

  private async runRaw(args: string[], timeoutMs: number): Promise<string> {
    try {
      const { stdout } = await execa("agent-browser", ["--session", this.options.sessionName, ...args], {
        reject: true,
        env: process.env,
        timeout: timeoutMs
      });
      return stdout;
    } catch (error) {
      throw error;
    }
  }

  private async tryLaunch(): Promise<void> {
    try {
      await this.runRaw(["launch"], this.options.commandTimeoutMs);
    } catch {
      // Backward compatibility: some agent-browser versions auto-launch on open and do not expose launch.
    }
  }

  private async tryWaitForNetworkIdle(): Promise<void> {
    try {
      await this.runRaw(["wait", "--load", "networkidle"], this.options.waitNetworkIdleTimeoutMs);
    } catch (error) {
      // Fail-fast for flaky pages/daemon stalls; continue and try DOM extraction anyway.
      if (isRecoverableWaitError(error)) {
        return;
      }
      throw this.wrapRunError(["wait", "--load", "networkidle"], error);
    }
  }

  private wrapRunError(args: string[], error: unknown): Error {
    if (error instanceof Error) {
      return new Error(`agent-browser command failed (${args.join(" ")}): ${error.message}`);
    }
    return new Error(`agent-browser command failed (${args.join(" ")}): ${String(error)}`);
  }
}

function isBrowserNotLaunchedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Browser not launched\. Call launch first\./i.test(error.message);
}

function isRecoverableWaitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("resource temporarily unavailable") ||
    message.includes("daemon may be busy or unresponsive") ||
    message.includes("http fetch failed")
  );
}

function normalizeAgentOutput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return parsed.trim();
    }
    if (parsed && typeof parsed === "object") {
      if (typeof (parsed as { result?: unknown }).result === "string") {
        return ((parsed as { result: string }).result).trim();
      }
      if (typeof (parsed as { stdout?: unknown }).stdout === "string") {
        return ((parsed as { stdout: string }).stdout).trim();
      }
    }
  } catch {
    // Fall through to plain-text normalization.
  }

  const startsWithQuote = trimmed.startsWith('"') || trimmed.startsWith("'");
  const endsWithQuote = trimmed.endsWith('"') || trimmed.endsWith("'");
  if (startsWithQuote && endsWithQuote) {
    const unwrapped = trimmed.slice(1, -1);
    return unwrapped.replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
  }

  return trimmed;
}
