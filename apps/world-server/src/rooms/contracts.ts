import type { ChatProvider, WebResearchProvider } from "@chatverse/core";

export interface ProviderPair {
  directorProvider: ChatProvider;
  narratorProvider?: ChatProvider;
  characterProvider: ChatProvider;
  authoringProvider?: ChatProvider;
  researchProvider?: WebResearchProvider;
}
