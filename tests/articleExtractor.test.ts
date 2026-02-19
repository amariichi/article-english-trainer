import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentBrowserClient } from "../src/article/agentBrowserClient.js";
import { fetchArticle } from "../src/article/articleExtractor.js";
import { loadEnv } from "../src/config/env.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchArticle preflight", () => {
  it("fails fast when preflight returns 403", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const extractArticle = vi.fn();
    const client: AgentBrowserClient = { extractArticle };

    const env = loadEnv({
      ARTICLE_MIN_CHARS: "10",
      ARTICLE_REACHABILITY_TIMEOUT_MS: "3000"
    });

    await expect(fetchArticle("https://www.economist.com", env, client)).rejects.toThrow(/HTTP 403/i);
    expect(extractArticle).not.toHaveBeenCalled();
  });

  it("falls back to GET preflight when HEAD is not supported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 405 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const extractArticle = vi.fn().mockResolvedValue({
      title: "Example",
      text: "This is a sufficiently long extracted body."
    });
    const client: AgentBrowserClient = { extractArticle };

    const env = loadEnv({
      ARTICLE_MIN_CHARS: "10",
      ARTICLE_REACHABILITY_TIMEOUT_MS: "3000"
    });

    const article = await fetchArticle("https://example.com/article", env, client);
    expect(article.title).toBe("Example");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(extractArticle).toHaveBeenCalledTimes(1);
  });
});
