import type {
  ChatProvider,
  LLMMessage,
  TokenUsage,
  WebResearchProvider,
} from "@chatverse/core";
import type { DraftIdGenerator } from "./draft.js";
import type {
  WorldArchitectResult,
  WorldAuthoringPlan,
  WorldDraft,
  WorldDraftBatchCommit,
  WorldDraftBatchReceipt,
  WorldDraftChangeSet,
  WorldDraftOperation,
  DraftResearchSource,
  WorldResearchEvent,
  WorldSourceDraftArtifact,
  WorldSourceMaterialDocument,
} from "./types.js";
import { validateWorldDraft } from "./validation.js";
import { WORLD_ARCHITECT_SYSTEM_PROMPT } from "./architect/prompt.js";
import { worldArchitectTools } from "./architect/tools/definitions.js";
import {
  activePlanItem,
  createDefaultIdGenerator,
  isDraftMutationTool,
} from "./architect/tools/parsing.js";
import {
  draftIndex,
  mergeResearchSources,
  summarizeOperations,
} from "./draft/inspection.js";
import { summarizeToolObservation } from "./session/observations.js";
import {
  executeAuthoringTool,
  type AuthoringToolContext,
} from "./architect/tool-runner.js";

export interface WorldArchitectOptions {
  maxToolRounds?: number;
  maxTokens?: number;
  nextId?: DraftIdGenerator;
  trace?: (event: WorldArchitectTrace) => void;
  onTextDelta?: (delta: string) => void;
  researchProvider?: WebResearchProvider;
  researchEnabled?: boolean;
  onResearchEvent?: (event: WorldResearchEvent) => void;
  onResearchUsage?: (usage: TokenUsage) => void;
  sourceMaterials?: readonly WorldSourceMaterialDocument[];
  onBatchCommitted?: (commit: WorldDraftBatchCommit) => void | Promise<void>;
}

export interface WorldArchitectTrace {
  type: "prompt" | "response" | "tool_start" | "tool" | "step_end";
  round: number;
  payload: Record<string, unknown>;
}

export type { WorldResearchEvent } from "./types.js";

export class WorldArchitect {
  private readonly maxToolRounds?: number;
  private readonly maxTokens?: number;
  private readonly nextId: DraftIdGenerator;

  constructor(
    private readonly provider: ChatProvider,
    private readonly options: WorldArchitectOptions = {},
  ) {
    this.maxToolRounds = options.maxToolRounds;
    this.maxTokens = options.maxTokens;
    this.nextId = options.nextId ?? createDefaultIdGenerator();
  }

  async run(input: {
    draft: WorldDraft;
    instruction: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    plan?: WorldAuthoringPlan;
    signal?: AbortSignal;
  }): Promise<WorldArchitectResult> {
    const baseDraft = structuredClone(input.draft);
    let workingDraft = structuredClone(input.draft);
    const operations: WorldDraftOperation[] = [];
    const batchReceipts: WorldDraftBatchReceipt[] = [];
    const researchSources: DraftResearchSource[] = [];
    const sourceArtifacts: WorldSourceDraftArtifact[] = [];
    let summary = "";
    let questions: string[] = [];
    let finished = false;
    let steps = 0;
    let toolCallCount = 0;
    let invalidToolArgumentCount = 0;
    let stopReason: WorldArchitectResult["execution"]["stopReason"] = "round_limit";
    let plan = input.plan ? structuredClone(input.plan) : undefined;
    const messages: LLMMessage[] = [
      { role: "system", content: WORLD_ARCHITECT_SYSTEM_PROMPT },
      ...(input.history ?? []).slice(-8).map((message): LLMMessage => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user",
        content: [
          "[草稿索引]",
          JSON.stringify(draftIndex(workingDraft)),
          "[创作计划]",
          plan ? JSON.stringify(plan) : "(当前没有创作计划；按需直接对话或处理请求)",
          "[可用能力]",
          this.options.researchProvider && this.options.researchEnabled
            ? "research_web 已启用。"
            : "research_web 未启用；不要调用它。",
          "[创作者要求]",
          input.instruction.trim(),
        ].join("\n\n"),
      },
    ];
    const toolDefinitions = worldArchitectTools(Boolean(
      this.options.researchProvider && this.options.researchEnabled,
    ));
    for (
      let round = 0;
      (this.maxToolRounds === undefined || round < this.maxToolRounds) && !finished;
      round++
    ) {
      steps = round + 1;
      this.options.trace?.({
        type: "prompt",
        round,
        payload: { messageCount: messages.length, revision: workingDraft.revision },
      });
      const response = await this.provider.chat({
        messages,
        tools: toolDefinitions,
        thinking: "enabled",
        reasoningEffort: "max",
        ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
        signal: input.signal,
        requestContext: { purpose: "world_authoring" },
        onTextDelta: this.options.onTextDelta,
      });
      const content = response.content?.trim() ?? "";
      const actionCalls = response.toolCalls;
      this.options.trace?.({
        type: "response",
        round,
        payload: {
          content,
          toolCalls: actionCalls,
          reasoningChars: response.reasoningContent?.length ?? 0,
          finishReason: response.finishReason,
          usage: response.usage,
        },
      });
      if (response.finishReason === "max_tokens" && actionCalls.length === 0) {
        summary = content || (operations.length
          ? "已保留本轮成功写入的草稿修改；模型输出达到上限，自动循环已停止。"
          : "模型输出达到上限，本轮未形成可提交的草稿修改。");
        stopReason = "max_tokens";
        this.options.trace?.({
          type: "step_end",
          round,
          payload: { reason: stopReason },
        });
        break;
      }
      if (!actionCalls.length) {
        summary = content || "本轮没有产生修改。";
        stopReason = content ? "natural_response" : "no_change";
        this.options.trace?.({
          type: "step_end",
          round,
          payload: { reason: stopReason },
        });
        break;
      }

      const assistant: LLMMessage = {
        role: "assistant",
        content: response.content ?? "",
        tool_calls: actionCalls,
      };
      if (response.reasoningContent) {
        assistant.reasoningContent = response.reasoningContent;
      }
      messages.push(assistant);

      const toolContext: AuthoringToolContext = {
        getWorkingDraft: () => workingDraft,
        setWorkingDraft: (value) => { workingDraft = value; },
        operations,
        batchReceipts,
        nextId: this.nextId,
        getPlan: () => plan,
        setPlan: (value) => { plan = value; },
        researchProvider: this.options.researchProvider,
        researchEnabled: Boolean(this.options.researchEnabled),
        researchSources,
        signal: input.signal,
        onResearchEvent: this.options.onResearchEvent,
        onResearchUsage: this.options.onResearchUsage,
        sourceMaterials: this.options.sourceMaterials ?? [],
        sourceArtifacts,
        onBatchCommitted: this.options.onBatchCommitted,
      };
      for (const call of actionCalls) {
        toolCallCount++;
        this.options.trace?.({
          type: "tool_start",
          round,
          payload: {
            callId: call.id,
            name: call.function.name,
            argumentBytes: call.function.arguments.length,
          },
        });
        const result = await executeAuthoringTool(call, toolContext);
        this.options.trace?.({
          type: "tool",
          round,
          payload: {
            callId: call.id,
            name: call.function.name,
            ok: result.ok,
            observation: summarizeToolObservation(result.payload),
          },
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: result.ok,
            ...result.payload,
          }),
        });
        if (result.ok && isDraftMutationTool(call.function.name)) {
          invalidToolArgumentCount = 0;
        } else if (result.payload.errorType === "invalid_tool_arguments") {
          invalidToolArgumentCount++;
          if (invalidToolArgumentCount >= 2) {
            summary = operations.length
              ? "已保留成功写入的草稿修改；当前工具参数连续两次不完整，已停止本轮以避免重复消耗。"
              : "当前写入工具的参数连续两次不完整，已停止本轮。请直接重试这一步。";
            finished = true;
            stopReason = "tool_input_error";
          }
        }
        if (result.finish) {
          summary = result.finish.summary;
          questions = result.finish.questions;
          finished = true;
          stopReason = "finished";
        }
        if (finished && stopReason === "tool_input_error") break;
      }
      this.options.trace?.({
        type: "step_end",
        round,
        payload: {
          reason: finished ? "finished" : "tools_observed",
          revision: workingDraft.revision,
        },
      });
    }

    if (researchSources.length) {
      workingDraft = {
        ...workingDraft,
        researchSources: mergeResearchSources(
          baseDraft.researchSources,
          researchSources,
        ),
      };
    }

    const validation = validateWorldDraft(workingDraft);
    const changeSet: WorldDraftChangeSet | undefined = operations.length
      ? {
          id: this.nextId("change"),
          baseRevision: baseDraft.revision,
          nextRevision: workingDraft.revision,
          summary: summary || summarizeOperations(operations),
          operations: structuredClone(operations),
          validation,
          planItemId: activePlanItem(plan)?.id,
          researchSources: researchSources.length
            ? structuredClone(researchSources)
            : undefined,
        }
      : undefined;

    return {
      summary: summary || (operations.length
        ? summarizeOperations(operations)
        : sourceArtifacts.length
          ? `已整理 ${sourceArtifacts[0]!.documents.length} 篇 Markdown 世界资料。`
          : "本轮没有产生修改。"),
      questions,
      workingDraft,
      changeSet,
      batchReceipts: batchReceipts.length ? structuredClone(batchReceipts) : undefined,
      sourceArtifacts: sourceArtifacts.length ? structuredClone(sourceArtifacts) : undefined,
      plan,
      execution: {
        steps,
        toolCalls: toolCallCount,
        stopReason,
      },
    };
  }
}
