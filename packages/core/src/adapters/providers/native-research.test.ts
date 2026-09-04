import { afterEach, describe, expect, it, vi } from "vitest";
import { createTavilyResearchProvider } from "./tavily-research.js";
import { createZhipuResearchProvider } from "./zhipu-research.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("native web research providers", () => {
  it("maps Tavily Search API requests and results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answer: "归纳摘要",
      results: [{ title: "来源一", url: "https://example.com/one", content: "正文片段" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock;
    const provider = createTavilyResearchProvider({
      protocol: "tavily-search",
      apiKey: "tavily-secret",
      options: { searchDepth: "advanced", maxResults: 6 },
    });

    const result = await provider.search({ query: "赤壁之战", purpose: "世界资料" });

    expect(provider.profile).toMatchObject({ protocol: "tavily-search", providerName: "Tavily" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tavily-secret" }),
    }));
    const tavilyRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(tavilyRequest).toBeDefined();
    expect(JSON.parse(String(tavilyRequest?.body))).toMatchObject({
      query: "赤壁之战",
      search_depth: "advanced",
      max_results: 6,
      include_raw_content: false,
    });
    expect(result).toMatchObject({ summary: "归纳摘要", sources: [{ title: "来源一", note: "世界资料" }] });
  });

  it("maps Zhipu Web Search and clamps its query to the official limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      search_result: [{ title: "智谱来源", link: "https://example.cn/source", content: "资料正文" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock;
    const provider = createZhipuResearchProvider({
      protocol: "zhipu-web-search",
      apiKey: "zhipu-secret",
      model: "search_pro",
      options: { count: 12, contentSize: "high" },
    });

    const result = await provider.search({ query: "问".repeat(90), purpose: "事实校验" });
    const zhipuCall = fetchMock.mock.calls[0];
    expect(zhipuCall).toBeDefined();
    const request = JSON.parse(String((zhipuCall?.[1] as RequestInit | undefined)?.body));

    expect(zhipuCall?.[0]).toBe("https://open.bigmodel.cn/api/paas/v4/web_search");
    expect(request.search_query).toHaveLength(70);
    expect(request).toMatchObject({ search_engine: "search_pro", count: 12, content_size: "high" });
    expect(result).toMatchObject({ summary: "资料正文", sources: [{ title: "智谱来源", note: "事实校验" }] });
  });
});
