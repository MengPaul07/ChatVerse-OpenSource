import type { WebResearchProtocol, WebResearchProvider } from "../../contracts/provider.js";
import { createOpenAIResponsesResearchProvider } from "./openai-research.js";
import { createTavilyResearchProvider } from "./tavily-research.js";
import { createZhipuResearchProvider } from "./zhipu-research.js";

export interface WebResearchProviderConfig {
  protocol: WebResearchProtocol;
  apiKey: string;
  baseURL?: string;
  providerName?: string;
  model?: string;
  options?: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
}

export function createWebResearchProvider(config: WebResearchProviderConfig): WebResearchProvider {
  switch (config.protocol) {
    case "responses-web-search":
      return createOpenAIResponsesResearchProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        providerName: config.providerName,
        model: config.model,
        providerOptions: config.options,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      });
    case "tavily-search":
      return createTavilyResearchProvider(config);
    case "zhipu-web-search":
      return createZhipuResearchProvider(config);
  }
}
