import type {
  CharacterCard,
  SceneCard,
  WorldDefinition,
} from "@chatverse/core";
import {
  toBenchmarkObservation,
  type BenchmarkAction,
  type BenchmarkEngineAdapter,
  type BenchmarkObservation,
  type BenchmarkScenario,
  type BenchmarkWorldFixture,
} from "@chatverse/world-benchmark";
import { WorldRunLab } from "./runner.js";
import type { WorldRunProviders, WorldRunScenario, WorldRunStep } from "./types.js";

export interface ChatVerseWorldBenchAdapterOptions {
  providers: WorldRunProviders;
  timeMode?: "realtime" | "accelerated";
  debug?: boolean;
  stepTimeoutMs?: number;
}

/**
 * Current ChatVerse adapter. The benchmark package does not know this class;
 * it only consumes the normalized observation returned here.
 */
export function createChatVerseWorldBenchAdapter(
  options: ChatVerseWorldBenchAdapterOptions,
): BenchmarkEngineAdapter {
  return {
    name: "ChatVerse World",
    async run(scenario, runOptions): Promise<BenchmarkObservation> {
      try {
        const worldScenario = toWorldRunScenario(scenario);
        const report = await new WorldRunLab({
          scenario: worldScenario,
          providers: options.providers,
          timeMode: options.timeMode ?? "realtime",
          stepTimeoutMs: options.stepTimeoutMs,
          debug: options.debug,
        }).run();
        return toBenchmarkObservation({
          ...report,
          scenario: { id: scenario.id },
          steps: report.steps,
          durationMs: report.durationMs,
          checkpoints: report.checkpoints,
        }, {
          adapterName: "chatverse-world-run-lab",
          capabilities: [
            "scene_arbitration",
            "actor_performance",
            "macro_progression",
            "scene_actor_planning",
            "macro_dismiss",
            "context_inspection",
            "narrative_retrieval",
            "snapshot_restore",
          ],
          initialActors: scenario.fixture.actors
            .filter((actor) => actor.kind === "ai")
            .map((actor) => ({
              id: actor.id,
              name: actor.name,
              lifecycle: actor.lifecycle ?? "persistent",
            })),
        });
      } catch (error) {
        return failedObservation(scenario, runOptions?.runId, error);
      }
    },
  };
}

function toWorldRunScenario(scenario: BenchmarkScenario): WorldRunScenario {
  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    definition: toWorldDefinition(scenario.fixture),
    steps: scenario.actions.map(toWorldRunStep),
    targetEventCount: Math.max(1, scenario.actions.length),
    checkpointSequences: [],
    runAllSteps: true,
  };
}

function toWorldDefinition(fixture: BenchmarkWorldFixture): WorldDefinition {
  return {
    metadata: {
      id: `cvwb-${slug(fixture.name)}`,
      name: fixture.name,
      description: fixture.premise,
      version: "cvwb-1",
    },
    lore: {
      name: `${fixture.name} benchmark rules`,
      entries: fixture.rules.map((content, index) => ({
        keys: [],
        content,
        priority: 100 - index,
        position: "after" as const,
        constant: true,
      })),
    },
    actors: fixture.actors.map((actor) => actor.kind === "human"
      ? {
          id: actor.id,
          kind: "character" as const,
          card: characterCard(actor),
          playerControlled: true,
        }
      : {
          id: actor.id,
          kind: "character" as const,
          card: characterCard(actor),
          lifecycle: actor.lifecycle ?? "persistent",
        }),
    contexts: fixture.contexts.map((context) => ({
      id: context.id,
      kind: "chat" as const,
      name: context.name,
      actorIds: context.actorIds,
      scene: sceneCard(context, fixture.initialFacts),
      initiallyActive: false,
    })),
    chapters: (fixture.initialChapters ?? ["benchmark chapter"]).map((title, index) => ({
      id: `chapter-${index + 1}`,
      title,
      treatment: `${title}。这一章需要通过连续的现场观察、角色判断和行动反馈，逐步把开场问题推进到可观察的阶段性结果。`,
      targetOutcome: `围绕“${title}”形成一项可观察、可复核的阶段性结果。`,
      status: index === 0 ? "active" as const : "queued" as const,
      actorIds: fixture.actors.map((actor) => actor.id),
      contextIds: fixture.contexts.map((context) => context.id),
      beatIds: [],
    })),
    directorPolicy: {
      enabled: true,
      batchSize: 8,
      debounceMs: 0,
      minIntervalMs: 0,
      maxToolRounds: 2,
      narratorDebounceMs: 0,
      contextSuspendAfterMs: 120_000,
    },
    actorMemoryPolicy: { enabled: false },
  };
}

function toWorldRunStep(action: BenchmarkAction): WorldRunStep {
  switch (action.type) {
    case "start":
      return { id: action.id, type: "progression", label: action.label, contextId: action.contextId, reason: "bootstrap" };
    case "player_message":
      return { id: action.id, type: "message", label: action.label, contextId: action.contextId, actorId: action.actorId, message: action.message };
    case "player_directive":
      return {
        id: action.id,
        type: "directive",
        label: action.label,
        contextId: action.contextId,
        instruction: action.instruction,
        actorId: action.actorId,
      };
    case "world_event":
      return { id: action.id, type: "event", label: action.label, message: action.message, contextIds: action.contextIds, actorIds: action.actorIds };
    case "wait":
      return { id: action.id, type: "wait", label: action.label, durationMs: action.durationMs };
    case "pause":
    case "resume":
    case "snapshot":
    case "restore":
      return { id: action.id, type: action.type, label: action.label };
    case "advance_time":
      throw new Error("当前 ChatVerse Adapter 尚未公开世界时间推进入口。");
    case "provider_fault":
      throw new Error("当前 ChatVerse Adapter 尚未支持 Provider 故障注入。");
  }
}

function characterCard(actor: BenchmarkWorldFixture["actors"][number]): CharacterCard {
  return {
    name: actor.name,
    description: `${actor.role}。公开职责：${actor.capabilities?.join("、") || "无额外工具职责"}。`,
    personality: "保持克制，先区分亲眼确认、工具结果、推断和未知。",
    scenario: actor.privateKnowledge?.join("；") || actor.publicKnowledge.join("；") || "只依据现场可见信息行动。",
    messageExample: `${actor.name}：我只能说明我确认过的部分。`,
    instructions: "不把别人的推断当作自己的知识；不要因为推动剧情而获得卡片之外的精确事实。",
  };
}

function sceneCard(
  context: BenchmarkWorldFixture["contexts"][number],
  initialFacts: readonly string[] | undefined,
): SceneCard {
  return {
    groupName: context.name,
    topic: context.premise,
    atmosphere: "由基准场景驱动的现场状态",
    state: "idle",
    rules: [
      ...context.rules,
      ...(initialFacts ?? []).map((fact) => `初始事实：${fact}`),
    ],
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "world";
}

function failedObservation(
  scenario: BenchmarkScenario,
  runId: string | undefined,
  error: unknown,
): BenchmarkObservation {
  return {
    schemaVersion: 1,
    runId: runId ?? `${scenario.id}-failed`,
    scenarioId: scenario.id,
    engine: { name: "ChatVerse World", adapter: "chatverse-world-run-lab" },
    capabilities: [],
    actions: [],
    entries: [],
    actors: [],
    operations: [],
    toolCalls: [],
    metrics: { providerCalls: 0, directorCalls: 0, narratorCalls: 0, actorCalls: 0, totalTokens: 0, cacheHitRate: 0, wallTimeMs: 0, stallCount: 1 },
    failures: [error instanceof Error ? error.message : String(error)],
  };
}
