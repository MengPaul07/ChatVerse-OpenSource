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

const DEFAULT_BASE_URL = "https://open.bigmodel.cn";
const SEARCH_ENGINES = ["search_std", "search_pro", "search_pro_sogou", "search_pro_quark"] as const;

export function createZhipuResearchProvider(config: WebResearchProviderConfig): WebResearchProvider {
  const baseURL = config.baseURL ?? DEFAULT_BASE_URL;
  const providerName = config.providerName ?? "智谱 Web Search";
  const engine = SEARCH_ENGINES.includes(config.model as typeof SEARCH_ENGINES[number])
    ? config.model as typeof SEARCH_ENGINES[number]
    : stringOption(config.options, "searchEngine", SEARCH_ENGINES, "search_std");
  const count = numberOption(config.options, "count", 10, 1, 50);
  const contentSize = stringOption(config.options, "contentSize", ["medium", "high"] as const, "medium");
  return {
    profile: { protocol: "zhipu-web-search", providerName, baseURL, model: engine },
    async search({ query, purpose, signal }) {
      const request = createRequestSignal(signal, config.timeoutMs);
      try {
        const value = await postResearchJson({
          url: researchEndpoint(baseURL, "/api/paas/v4/web_search"),
          apiKey: config.apiKey,
          signal: request.signal,
          body: {
            search_query: query.slice(0, 70),
            search_engine: engine,
            search_intent: false,
            count,
            search_recency_filter: "noLimit",
            content_size: contentSize,
          },
        });
        return normalizeZhipuResult(value, purpose);
      } catch (error) {
        throw wrapProviderError(request.wrapError(error), {
          protocol: "zhipu-web-search",
          provider: providerName,
          model: engine,
        });
      } finally {
        request.cleanup();
      }
    },
  };
}

function normalizeZhipuResult(value: unknown, purpose: string): WebResearchResult {
  const record = asRecord(value);
  const results = Array.isArray(record?.search_result) ? record.search_result : [];
  const sources: WebResearchSource[] = [];
  const snippets: string[] = [];
  for (const item of results) {
    const result = asRecord(item);
    const url = limitedText(result?.link, 2_048);
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
    summary: limitedText(snippets.join("\n"), 1_500) ?? "联网搜索没有返回可用摘要。",
    sources: sources.slice(0, 8),
  };
}
