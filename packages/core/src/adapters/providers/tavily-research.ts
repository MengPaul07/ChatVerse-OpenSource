import type {
  WebResearchProvider,
  WebResearchResult,
  WebResearchSource,
} from "../../contracts/provider.js";
import { asRecord, createRequestSignal, isHttpUrl, wrapProviderError } from "./provider-utils.js";
import type { WebResearchProviderConfig } from "./research-factory.js";
import {
  limitedText,
  numberOption,
  postResearchJson,
  researchEndpoint,
  stringOption,
} from "./research-http.js";

const DEFAULT_BASE_URL = "https://api.tavily.com";

export function createTavilyResearchProvider(config: WebResearchProviderConfig): WebResearchProvider {
  const baseURL = config.baseURL ?? DEFAULT_BASE_URL;
  const providerName = config.providerName ?? "Tavily";
  const searchDepth = stringOption(
    config.options,
    "searchDepth",
    ["ultra-fast", "fast", "basic", "advanced"] as const,
    "basic",
  );
  const maxResults = numberOption(config.options, "maxResults", 8, 1, 20);
  return {
    profile: { protocol: "tavily-search", providerName, baseURL },
    async search({ query, purpose, signal }) {
      const request = createRequestSignal(signal, config.timeoutMs);
      try {
        const value = await postResearchJson({
          url: researchEndpoint(baseURL, "search"),
          apiKey: config.apiKey,
          signal: request.signal,
          body: {
            query,
            search_depth: searchDepth,
            max_results: maxResults,
            include_answer: config.options?.includeAnswer ?? "basic",
            include_raw_content: false,
            include_images: false,
          },
        });
        return normalizeTavilyResult(value, purpose);
      } catch (error) {
        throw wrapProviderError(request.wrapError(error), {
          protocol: "tavily-search",
          provider: providerName,
        });
      } finally {
        request.cleanup();
      }
    },
  };
}

function normalizeTavilyResult(value: unknown, purpose: string): WebResearchResult {
  const record = asRecord(value);
  const results = Array.isArray(record?.results) ? record.results : [];
  const sources: WebResearchSource[] = [];
  const snippets: string[] = [];
  for (const item of results) {
    const result = asRecord(item);
    const url = limitedText(result?.url, 2_048);
    if (!url || !isHttpUrl(url)) continue;
    const content = limitedText(result?.content, 500);
    if (content) snippets.push(content);
    sources.push({
      title: limitedText(result?.title, 300) ?? new URL(url).hostname,
      url,
      accessedAt: Date.now(),
      note: purpose,
    });
  }
  return {
    summary: limitedText(record?.answer, 1_500)
      ?? limitedText(snippets.join("\n"), 1_500)
      ?? "联网搜索没有返回可用摘要。",
    sources: sources.slice(0, 8),
  };
}
