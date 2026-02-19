import type { AppEnv } from "../config/env.js";
import { type AgentBrowserClient, CliAgentBrowserClient } from "./agentBrowserClient.js";

export interface ArticleDocument {
  url: string;
  title: string;
  text: string;
  fetchedAt: string;
}

export class ArticleValidationError extends Error {}

export class ArticleExtractionError extends Error {
  constructor(message: string, readonly manualFallbackRecommended: boolean) {
    super(message);
  }
}

export async function fetchArticle(
  url: string,
  env: AppEnv,
  client: AgentBrowserClient = new CliAgentBrowserClient({
    sessionName: env.AGENT_BROWSER_SESSION,
    authStatePath: env.AGENT_BROWSER_STATE_PATH,
    commandTimeoutMs: env.AGENT_BROWSER_COMMAND_TIMEOUT_MS,
    waitNetworkIdleTimeoutMs: env.AGENT_BROWSER_WAIT_NETWORKIDLE_TIMEOUT_MS
  })
): Promise<ArticleDocument> {
  const parsedUrl = validateArticleUrl(url);
  await assertUrlReachable(parsedUrl, env.ARTICLE_REACHABILITY_TIMEOUT_MS);

  let agentBrowserError: Error | null = null;
  try {
    const extracted = await client.extractArticle(parsedUrl.toString());
    return buildArticleDocument(parsedUrl, extracted.title, extracted.text, env.ARTICLE_MIN_CHARS);
  } catch (error) {
    if (error instanceof Error) {
      agentBrowserError = error;
    }
  }

  try {
    const extracted = await fetchArticleViaHttp(parsedUrl, env.ARTICLE_MIN_CHARS);
    return buildArticleDocument(parsedUrl, extracted.title, extracted.text, env.ARTICLE_MIN_CHARS);
  } catch (httpError) {
    const details = [
      agentBrowserError ? `agent-browser: ${agentBrowserError.message}` : null,
      httpError instanceof Error ? `http: ${httpError.message}` : null
    ]
      .filter((line): line is string => Boolean(line))
      .join(" | ");

    if (details.length > 0) {
      throw new ArticleExtractionError(`Failed to fetch article: ${details}`, true);
    }
    throw new ArticleExtractionError("Failed to fetch article", true);
  }
}

export function validateArticleUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ArticleValidationError("URL must be a valid absolute URL");
  }
  return url;
}

function buildArticleDocument(url: URL, title: string, text: string, minChars: number): ArticleDocument {
  const normalizedTitle = normalizeWhitespace(title);
  const normalizedText = normalizeWhitespace(text);

  if (!normalizedTitle || normalizedTitle.length < 4) {
    throw new ArticleValidationError("Failed to extract article title from page");
  }

  if (!normalizedText || normalizedText.length < minChars) {
    throw new ArticleValidationError(`Extracted article text is too short (${normalizedText.length} chars)`);
  }

  return {
    url: url.toString(),
    title: normalizedTitle,
    text: normalizedText,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchArticleViaHttp(url: URL, minChars: number): Promise<{ title: string; text: string }> {
  const response = await fetch(url.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP fetch failed (${response.status})`);
  }

  const html = await response.text();
  if (!html || html.length < 200) {
    throw new Error("HTTP response is too short");
  }

  const title = extractTitleFromHtml(html);
  const text = extractArticleTextFromHtml(html);
  if (text.length < minChars) {
    throw new Error(`HTTP extracted text is too short (${text.length} chars)`);
  }

  return { title, text };
}

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return "Article";
  }
  return decodeHtmlEntities(stripTags(match[1]));
}

function extractArticleTextFromHtml(html: string): string {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const candidate = articleMatch?.[1] ?? html;
  const withoutNoise = candidate
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const paragraphs = Array.from(withoutNoise.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => decodeHtmlEntities(stripTags(match[1])))
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length >= 40);

  if (paragraphs.length > 0) {
    return paragraphs.join("\n\n");
  }

  return normalizeWhitespace(decodeHtmlEntities(stripTags(withoutNoise)));
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (_full, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "nbsp") return " ";

    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return "";
  });
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

async function assertUrlReachable(url: URL, timeoutMs: number): Promise<void> {
  try {
    const headResponse = await fetch(url.toString(), {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36"
      }
    });
    if (headResponse.ok) {
      return;
    }

    // Some sites reject HEAD even when GET is allowed.
    if (headResponse.status === 405 || headResponse.status === 501) {
      const getResponse = await fetch(url.toString(), {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36"
        }
      });
      if (getResponse.ok) {
        return;
      }
      throw new ArticleExtractionError(`URL preflight failed with HTTP ${getResponse.status}`, true);
    }

    throw new ArticleExtractionError(`URL preflight failed with HTTP ${headResponse.status}`, true);
  } catch (error) {
    if (error instanceof ArticleExtractionError) {
      throw error;
    }
    const details = error instanceof Error ? error.message : String(error);
    throw new ArticleExtractionError(
      `URL reachability check failed within ${timeoutMs}ms: ${details}`,
      true
    );
  }
}
