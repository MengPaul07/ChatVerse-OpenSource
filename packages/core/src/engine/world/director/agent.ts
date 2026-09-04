import type {
  ChatProvider,
  LLMMessage,
  ToolCall,
} from "../../../contracts/provider.js";
import type { ResolvedWorldDirectorPolicy } from "../../../contracts/world.js";
import {
  worldDirectorBeatRoundTools,
  worldDirectorTools,
  type WorldDirectorMutation,
} from "./tools.js";
import {
  WORLD_DIRECTOR_SYSTEM_PROMPT,
  buildWorldDirectorUserPrompt,
} from "./prompt.js";
import {
  executeDirectorTool,
  isLookupTool,
  isSourceLookupTool,
  normalizeDirectorToolCall,
  type DirectorToolBindings,
} from "./tool-executor.js";
import type {
  WorldDirectorHost,
  WorldDirectorResult,
  WorldDirectorRunOptions,
  WorldDirectorTask,
  WorldDirectorTrace,
  WorldDirectorView,
} from "./types.js";

export class WorldDirector {
  constructor(
    private readonly provider: ChatProvider,
    private readonly policy: ResolvedWorldDirectorPolicy,
  ) {
  }

  async run(
    view: WorldDirectorView,
    host: WorldDirectorHost,
    signal?: AbortSignal,
    trace?: (event: WorldDirectorTrace) => void,
    options: WorldDirectorRunOptions = {},
  ): Promise<WorldDirectorResult> {
    const mutations: WorldDirectorMutation[] = [];
    const toolNames: string[] = [];
    const failedToolNames: string[] = [];
    const taskMode = options.taskMode ?? view.task?.mode ?? "plan_beat";
    const isBeatPlanning = taskMode === "plan_beat" || taskMode === "transition_beat";
    if (isBeatPlanning) {
      return this.runBeatWorkflow(view, host, signal, trace, options);
    }
    const sourceEnabled = view.sourceBindings.length > 0;
    const tools = worldDirectorTools(this.policy.actorAuthority, taskMode, sourceEnabled);
    const availableToolNames = new Set(tools.map((tool) => tool.function.name));
    let taskRetryCount = 0;
    const userPrompt = buildWorldDirectorUserPrompt(view, options);
    const messages: LLMMessage[] = [
      { role: "system", content: WORLD_DIRECTOR_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const maxToolRounds = this.policy.maxToolRounds;
    const strictSourceRequired = view.sourceBindings.some((binding) => binding.fidelity === "strict");
    const readSourceChunkIds = new Set<string>();
    for (let round = 0; round < maxToolRounds; round++) {
      const forceCommitRound = (
        options.progressionRequired === true &&
        round === maxToolRounds - 1 &&
        mutations.length === 0
      );
      const roundTools = forceCommitRound
        ? tools.filter((tool) => !isLookupTool(tool.function.name))
        : tools;
      trace?.({
        type: "prompt",
        round,
        payload: {
          systemPrompt: WORLD_DIRECTOR_SYSTEM_PROMPT,
          userPrompt,
          messageCount: messages.length,
          toolCount: roundTools.length,
          referenceMap: view.references.debugMapping(),
        },
      });
      const startedAt = host.now();
      const response = await this.provider.chat({
        messages,
        tools: roundTools,
        toolChoice: roundTools.length === 0
          ? undefined
          : resolveDirectorToolChoice(this.provider, options.progressionRequired === true),
        thinking: "disabled",
        maxTokens: 2_800,
        stream: true,
        requestContext: {
          purpose: "world_director",
          turnId: options.planId,
        },
        signal,
      });
      trace?.({
        type: "response",
        round,
        payload: {
          content: view.references.redactModelOutput(response.content ?? ""),
          toolCalls: redactToolCalls(response.toolCalls, view.references),
          elapsedMs: Math.max(0, host.now() - startedAt),
        },
      });
      if (!response.toolCalls.length) {
        const missingToolNames = missingTaskTools(
          view.task,
          toolNames,
          availableToolNames,
        );
        if (shouldRetryTask(
          mutations,
          missingToolNames,
          taskRetryCount,
          options.progressionRequired === true,
        )) {
          taskRetryCount++;
          traceTaskRetry(trace, taskRetryCount, round, mutations, missingToolNames);
          messages.push({
            role: "assistant",
            content: view.references.redactModelOutput(response.content ?? ""),
          });
          messages.push({
            role: "user",
            content: view.references.redactKnownIds(buildTaskReminder(view.task, missingToolNames)),
          });
          continue;
        }
        return finishResult(
          view.task,
          mutations,
          toolNames,
          failedToolNames,
          taskRetryCount,
          missingToolNames,
        );
      }

      const normalizedToolCalls = response.toolCalls.map(normalizeDirectorToolCall);
      const providerToolCalls = redactToolCalls(normalizedToolCalls, view.references);
      const assistant: LLMMessage = {
        role: "assistant",
        content: view.references.redactModelOutput(response.content ?? ""),
        tool_calls: providerToolCalls,
      };
      if (response.reasoningContent) {
        assistant.reasoningContent = view.references.redactModelOutput(response.reasoningContent);
      }
      messages.push(assistant);

      let finished = false;
      const mutationCountBeforeRound = mutations.length;
      let usedLookupTool = false;
      let sourceReadAccepted = false;
      const roundToolNames = new Set(roundTools.map((tool) => tool.function.name));
      const roundHasSourceLookup = normalizedToolCalls.some((call) => (
        roundToolNames.has(call.function.name) && isSourceLookupTool(call.function.name)
      ));
      const sourceChunkIdsReadBeforeRound = new Set(readSourceChunkIds);
      for (const call of normalizedToolCalls) {
        if (!roundToolNames.has(call.function.name)) {
          const output = `Error: Tool is not available in Director round ${round + 1}: ${call.function.name}`;
          failedToolNames.push(call.function.name);
          trace?.({
            type: "tool_result",
            round,
            payload: {
              toolName: call.function.name,
              accepted: false,
              error: view.references.redactModelOutput(output),
            },
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: view.references.redactModelOutput(output),
          });
          continue;
        }
        if (isLookupTool(call.function.name)) usedLookupTool = true;
        const result = executeDirectorTool(
          call,
          mutations,
          host,
          view.references,
          readSourceChunkIds,
          sourceChunkIdsReadBeforeRound,
          roundHasSourceLookup,
          strictSourceRequired,
        );
        trace?.({
          type: "tool_result",
          round,
          payload: {
            toolName: call.function.name,
            accepted: result.accepted,
            error: result.accepted
              ? undefined
              : view.references.redactModelOutput(result.output),
          },
        });
        if (call.function.name === "retrieve_source" && result.accepted) {
          sourceReadAccepted = true;
        }
        if (call.function.name !== "finish") {
          if (result.accepted) toolNames.push(call.function.name);
          else failedToolNames.push(call.function.name);
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.accepted
            ? view.references.redactKnownIds(result.output)
            : view.references.redactModelOutput(result.output),
        });
        if (result.finished) finished = true;
      }
      if (sourceReadAccepted && mutations.length === mutationCountBeforeRound) {
        const readableChunks = [...readSourceChunkIds]
          .map((value) => {
            const [bundleId, chunkId] = value.split("\u0000");
            return bundleId && chunkId
              ? view.references.sourceChunkRef(bundleId, chunkId) ?? "(source chunk)"
              : "(source chunk)";
          })
          .join(", ");
        messages.push({
          role: "user",
          content: [
            "[Markdown retrieval completed]",
            `已读取并可引用的 Source chunks：${readableChunks || "(none)"}`,
            "下一轮只调用 plan_beat；资料来源由 Host 自动绑定，不要输出 source bundle、chunk 或 event 的真实 ID。",
          ].join("\n"),
        });
      }
      if (finished) {
        const missingToolNames = missingTaskTools(
          view.task,
          toolNames,
          availableToolNames,
        );
        if (shouldRetryTask(
          mutations,
          missingToolNames,
          taskRetryCount,
          options.progressionRequired === true,
        )) {
          taskRetryCount++;
          traceTaskRetry(trace, taskRetryCount, round, mutations, missingToolNames);
          messages.push({
            role: "user",
            content: view.references.redactKnownIds(buildTaskReminder(view.task, missingToolNames)),
          });
          continue;
        }
        return finishResult(
          view.task,
          mutations,
          toolNames,
          failedToolNames,
          taskRetryCount,
          missingToolNames,
        );
      }
      if (mutations.length > mutationCountBeforeRound && !usedLookupTool) {
        const missingToolNames = missingTaskTools(
          view.task,
          toolNames,
          availableToolNames,
        );
        if (missingToolNames.length === 0) {
          return finishResult(
            view.task,
            mutations,
            toolNames,
            failedToolNames,
            taskRetryCount,
            missingToolNames,
          );
        }
      }
    }

    const missingToolNames = missingTaskTools(
      view.task,
      toolNames,
      availableToolNames,
    );
    return finishResult(
      view.task,
      mutations,
      toolNames,
      failedToolNames,
      taskRetryCount,
      missingToolNames,
    );
  }

  private async runBeatWorkflow(
    view: WorldDirectorView,
    host: WorldDirectorHost,
    signal: AbortSignal | undefined,
    trace: ((event: WorldDirectorTrace) => void) | undefined,
    options: WorldDirectorRunOptions,
  ): Promise<WorldDirectorResult> {
    const mutations: WorldDirectorMutation[] = [];
    const userPrompt = buildWorldDirectorUserPrompt(view, options);
    const activeChapterId = view.foregroundChapterId;
    const binding = view.sourceBindings[0];
    const source = binding
      ? host.retrieveSource(
          binding.bundleId,
          `${view.task?.objective ?? "规划下一幕"}\n${view.chapterSummary}`,
          4,
        )
      : undefined;
    const planTool = worldDirectorBeatRoundTools(1, false)[0];
    if (!planTool) throw new Error("Beat JSON schema is unavailable.");
    const sourceContext = source && binding
      ? [
          "[Host-retrieved Markdown Source]",
          `sourceRef=${view.references.refFor("source", binding.bundleId) ?? "(unresolved)"}`,
          `revision=${binding.revision}`,
          `chunkRefs=${view.references.registerSourceChunks(binding.bundleId, source.chunkIds).join(", ") || "(none)"}`,
          view.references.redactKnownIds(source.content),
        ].join("\n")
      : "[Host-retrieved Markdown Source]\n(none)";
    const workflowPrompt = [
      userPrompt,
      sourceContext,
      "[Fixed Beat workflow]",
      "直接输出一个 JSON 对象，不要 Markdown、解释、工具调用或隐藏计划。",
      "只填写 Beat 内容；Host 会自动绑定 active Chapter、当前 Event 和已检索 Source 引用。不要输出 chapterId、sourceEventIds、sourceBundleId、sourceChunkIds 或 sourceBindingRevision。",
      `JSON Schema: ${JSON.stringify(planTool.function.parameters)}`,
    ].join("\n\n");
    let previousRaw = "";
    let previousError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0
        ? workflowPrompt
        : [
            "修复下面的 Beat JSON。只返回完整 JSON 对象，不重新规划，不解释。",
            `校验错误：${view.references.redactModelOutput(previousError)}`,
            `原始输出：${view.references.redactModelOutput(previousRaw)}`,
            `JSON Schema: ${JSON.stringify(planTool.function.parameters)}`,
          ].join("\n\n");
      trace?.({
        type: "prompt",
        round: attempt,
        payload: {
          systemPrompt: WORLD_DIRECTOR_SYSTEM_PROMPT,
          userPrompt: prompt,
          messageCount: 2,
          toolCount: 0,
          workflow: "beat_json",
          referenceMap: view.references.debugMapping(),
        },
      });
      const startedAt = host.now();
      const response = await this.provider.chat({
        messages: [
          { role: "system", content: WORLD_DIRECTOR_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        toolChoice: "none",
        thinking: "disabled",
        reasoningEffort: directorReasoningEffort(this.provider),
        maxTokens: beatWorkflowMaxTokens(this.provider),
        stream: true,
        requestContext: {
          purpose: "world_director",
          turnId: options.planId,
        },
        signal,
      });
      const raw = response.content?.trim()
        || response.toolCalls.find((call) => call.function.name === "plan_beat")?.function.arguments
        || "";
      trace?.({
        type: "response",
        round: attempt,
        payload: {
          content: view.references.redactModelOutput(raw),
          toolCalls: [],
          elapsedMs: Math.max(0, host.now() - startedAt),
          workflow: "beat_json",
        },
      });
      previousRaw = view.references.redactModelOutput(raw);
      try {
        const args = parseBeatWorkflowJson(raw);
        if (binding && source?.chunkIds.length) {
          args.sourceAdherence ??= binding.fidelity === "strict" ? "follow" : "adapt";
        }
        const sourceEventIds = [...(view.task?.sourceEventIds ?? view.eventBatch.map((event) => event.id))];
        const hostBindings: DirectorToolBindings = {
          chapterId: activeChapterId,
          sourceEventIds,
          sourceBundleId: binding && source?.chunkIds.length ? binding.bundleId : undefined,
          sourceChunkIds: binding && source?.chunkIds.length ? [...source.chunkIds] : undefined,
          sourceBindingRevision: binding && source?.chunkIds.length ? binding.revision : undefined,
        };
        const readSourceChunkIds = new Set<string>(
          binding && source
            ? source.chunkIds.map((chunkId) => `${binding.bundleId}\u0000${chunkId}`)
            : [],
        );
        const result = executeDirectorTool(
          {
            id: `beat-workflow-${attempt + 1}`,
            type: "function",
            function: { name: "plan_beat", arguments: JSON.stringify(args) },
          },
          mutations,
          host,
          view.references,
          readSourceChunkIds,
          readSourceChunkIds,
          false,
          view.sourceBindings.some((item) => item.fidelity === "strict"),
          hostBindings,
        );
        trace?.({
          type: "tool_result",
          round: attempt,
          payload: {
            toolName: "beat_workflow_commit",
            accepted: result.accepted,
            error: result.accepted
              ? undefined
              : view.references.redactModelOutput(result.output),
          },
        });
        if (!result.accepted) throw new Error(result.output);
        return {
          mutations,
          toolNames: ["beat_workflow_commit"],
          failedToolNames: [],
          taskRetryCount: attempt,
          taskStatus: "complete",
          missingToolNames: [],
        };
      } catch (error) {
        previousError = view.references.redactModelOutput(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return {
      mutations: [],
      toolNames: [],
      failedToolNames: ["beat_workflow_commit"],
      taskRetryCount: 1,
      taskStatus: "empty",
      missingToolNames: [],
    };
  }
}

function beatWorkflowMaxTokens(provider: ChatProvider): number {
  const profile = provider.profile;
  const requested = profile?.compatibility.supportsThinkingDisable === false ? 16_000 : 8_000;
  return Math.min(requested, profile?.maxOutputTokens ?? requested);
}

function redactToolCalls(
  calls: readonly ToolCall[],
  references: WorldDirectorView["references"],
): ToolCall[] {
  return calls.map((call) => ({
    ...call,
    function: {
      ...call.function,
      arguments: references.redactModelOutput(call.function.arguments),
    },
  }));
}

function directorReasoningEffort(provider: ChatProvider): "off" | "minimal" {
  return provider.profile?.compatibility.supportsThinkingDisable === false
    && provider.profile.compatibility.supportsReasoningEffort !== false
    ? "minimal"
    : "off";
}

function parseBeatWorkflowJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  if (start < 0) throw new Error("Director did not return a Beat JSON object.");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index++) {
    const char = trimmed[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      const parsed = JSON.parse(trimmed.slice(start, index + 1)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Director Beat output must be one JSON object.");
      }
      return parsed as Record<string, unknown>;
    }
  }
  throw new Error("Director returned an incomplete Beat JSON object.");
}

/**
 * `required` is useful for endpoints that support it, but OpenAI-compatible
 * services are not required to implement that extension. Keep the Director's
 * task contract in the prompt/retry loop and use the endpoint's declared
 * strongest mode for the wire request.
 */
export function resolveDirectorToolChoice(
  provider: Pick<ChatProvider, "profile">,
  progressionRequired: boolean,
): "auto" | "required" {
  if (!progressionRequired) return "auto";
  return provider.profile?.capabilities.toolChoice === "auto" ? "auto" : "required";
}

const KNOWN_DIRECTOR_TOOL_NAMES = [
  "update_actor_background",
  "emit_world_event",
  "plan_beat",
  "link_beats",
  "advance_world_time",
  "dismiss_spawned_actor",
  "set_actor_participation",
  "set_actor_presence",
] as const;

export function inferDirectorToolNames(instruction: string): string[] {
  return KNOWN_DIRECTOR_TOOL_NAMES.filter((name) => instruction.includes(name));
}

function missingTaskTools(
  task: WorldDirectorTask | undefined,
  toolNames: readonly string[],
  availableToolNames: ReadonlySet<string>,
): string[] {
  if (!task) return [];
  const completed = new Set(toolNames);
  return task.requiredToolNames.filter((name) => (
    availableToolNames.has(name) && !completed.has(name)
  ));
}

function shouldRetryTask(
  mutations: readonly WorldDirectorMutation[],
  missingToolNames: readonly string[],
  retryCount: number,
  progressionRequired: boolean,
): boolean {
  if (retryCount >= 1) return false;
  return missingToolNames.length > 0 || (progressionRequired && mutations.length === 0);
}

function buildTaskReminder(
  task: WorldDirectorTask | undefined,
  missingToolNames: readonly string[],
): string {
  if (!task) {
    return [
      "[Progression feedback]",
      "No accepted world mutation has been staged yet.",
      "Advance the world by the smallest useful step with an available mutation tool, then finish. Inspection alone is not progression.",
    ].join("\n");
  }
  const missing = missingToolNames.length > 0
    ? `Missing required available tools: ${missingToolNames.join(", ")}.`
    : "No accepted world mutation has been staged yet.";
  return [
    "[Task feedback]",
    missing,
    `Complete this objective before finish: ${task.objective}`,
    "Use the available tools to stage the smallest valid mutation. Do not write dialogue or claim completion without a mutation.",
  ].join("\n");
}

function traceTaskRetry(
  trace: ((event: WorldDirectorTrace) => void) | undefined,
  attempt: number,
  round: number,
  mutations: readonly WorldDirectorMutation[],
  missingToolNames: readonly string[],
): void {
  trace?.({
    type: "task_retry",
    round,
    payload: {
      attempt,
      stagedMutationCount: mutations.length,
      missingToolNames: [...missingToolNames],
    },
  });
}

function finishResult(
  task: WorldDirectorTask | undefined,
  mutations: WorldDirectorMutation[],
  toolNames: string[],
  failedToolNames: string[],
  taskRetryCount: number,
  missingToolNames: string[],
): WorldDirectorResult {
  const taskStatus = task
    ? mutations.length === 0
      ? "empty"
      : missingToolNames.length > 0
        ? "partial"
        : "complete"
    : undefined;
  return {
    mutations,
    toolNames,
    failedToolNames,
    taskRetryCount,
    taskStatus,
    missingToolNames,
  };
}
