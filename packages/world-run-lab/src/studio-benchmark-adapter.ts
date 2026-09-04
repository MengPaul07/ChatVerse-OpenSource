import type { ChatProvider, TokenUsage, WebResearchProvider } from "@chatverse/core";
import {
  type StudioBenchmarkEngineAdapter,
  type StudioBenchmarkObservation,
  type StudioBenchmarkScenario,
} from "@chatverse/world-benchmark";
import {
  createEmptyWorldDraft,
  WorldArchitect,
} from "@chatverse/world-authoring";

export function createChatVerseStudioBenchAdapter(options: {
  provider: ChatProvider;
  researchProvider: WebResearchProvider;
  maxToolRounds?: number;
}): StudioBenchmarkEngineAdapter {
  return {
    name: "ChatVerse World Studio",
    async run(scenario, runOptions) {
      return runStudioScenario(scenario, options, runOptions);
    },
  };
}

async function runStudioScenario(
  scenario: StudioBenchmarkScenario,
  options: {
    provider: ChatProvider;
    researchProvider: WebResearchProvider;
    maxToolRounds?: number;
  },
  runOptions?: { runId?: string; signal?: AbortSignal },
): Promise<StudioBenchmarkObservation> {
  const runId = runOptions?.runId ?? `${scenario.id}-${Date.now()}`;
  let providerCalls = 0;
  let researchCalls = 0;
  let totalTokens = 0;
  const addUsage = (usage: TokenUsage | undefined) => {
    if (!usage) return;
    totalTokens += usage.totalTokens;
  };
  try {
    const result = await new WorldArchitect(options.provider, {
      maxToolRounds: options.maxToolRounds,
      researchEnabled: scenario.researchEnabled,
      researchProvider: options.researchProvider,
      trace: (event) => {
        if (event.type !== "response") return;
        providerCalls++;
        addUsage(event.payload.usage as TokenUsage | undefined);
      },
      onResearchEvent: (event) => {
        if (event.type === "started") researchCalls++;
      },
      onResearchUsage: addUsage,
    }).run({
      draft: createEmptyWorldDraft({ id: `studio-benchmark:${scenario.id}` }),
      instruction: scenario.instruction,
      signal: runOptions?.signal,
    });
    const draft = result.workingDraft;
    const validation = result.changeSet?.validation;
    return {
      schemaVersion: 1,
      runId,
      scenarioId: scenario.id,
      engine: { name: "ChatVerse World Studio", adapter: "chatverse-world-authoring" },
      researchCalls,
      sourceCount: result.changeSet?.researchSources?.length ?? 0,
      providerCalls,
      totalTokens,
      operationTypes: result.changeSet?.operations.map((operation) => operation.type) ?? [],
      changeSetCreated: Boolean(result.changeSet),
      summary: result.summary,
      draft: {
        revision: draft.revision,
        actorCount: draft.actors.length,
        contextCount: draft.contexts.length,
        chapterCount: draft.chapters.length,
        hasPlayer: Boolean(draft.player),
        validationErrorCount: validation?.issues.filter((issue) => issue.severity === "error").length ?? 0,
      },
      failures: [],
      raw: result,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      runId,
      scenarioId: scenario.id,
      engine: { name: "ChatVerse World Studio", adapter: "chatverse-world-authoring" },
      researchCalls,
      sourceCount: 0,
      providerCalls,
      totalTokens,
      operationTypes: [],
      changeSetCreated: false,
      summary: "",
      draft: {
        revision: 0,
        actorCount: 0,
        contextCount: 0,
        chapterCount: 0,
        hasPlayer: false,
        validationErrorCount: 1,
      },
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }
}
