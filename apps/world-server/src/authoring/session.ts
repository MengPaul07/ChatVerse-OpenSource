import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { WorldSourceProvider } from "@chatverse/core";
import {
  WorldArchitect,
  applyWorldDraftOperations,
  validateWorldDraft,
  WorldDraftOperationError,
  WorldDraftRevisionError,
  type WorldArchitectResult,
  type WorldArchitectTrace,
  type WorldAuthoringPlan,
  type WorldAuthoringHarnessState,
  type WorldAuthoringSessionEvent,
  type WorldAuthoringSessionEventType,
  type WorldAuthoringTask,
  type WorldDraft,
  type WorldDraftBatchReceipt,
  type WorldDraftOperation,
  type WorldResearchEvent,
  type WorldSourceDraftArtifact,
  type WorldSourceMaterialDocument,
} from "@chatverse/world-authoring";
import type { ProviderPair } from "../rooms/contracts.js";
import type { ProviderFactory, ProviderRequestConfig } from "../provider-config.js";
import { ProviderRuntime } from "../provider-runtime.js";
import {
  compactText,
  errorMessage,
  formatArchitectMarkdown,
  nextTaskPhase,
  restoreAsNewRevision,
} from "./helpers.js";
import {
  runPreview,
  type AuthoringPreviewResult,
} from "./preview.js";
import {
  AuthoringStreamChannel,
  type AuthoringStreamKind,
} from "./stream.js";
import { AuthoringSessionLog } from "./session-log.js";
import { AuthoringTaskRuntime } from "./task-runtime.js";
import {
  publishResearchStreamEvent,
  recordAuthoringTrace,
} from "./session-telemetry.js";

// Keep the authoring budget below the 131072 ceiling used by GLM-compatible APIs.
const DEFAULT_AUTHORING_MAX_TOKENS = 128_000;
const DEFAULT_AUTHORING_MAX_TOOL_ROUNDS = 24;

export type AuthoringSessionStatus =
  | "idle"
  | "running"
  | "previewing"
  | "error";

export interface AuthoringConversationEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface AuthoringSessionView {
  id: string;
  status: AuthoringSessionStatus;
  acceptedDraft: WorldDraft;
  workingDraft: WorldDraft;
  task?: WorldAuthoringTask;
  canUndo: boolean;
  canRedo: boolean;
  conversation: AuthoringConversationEntry[];
  validation: ReturnType<typeof validateWorldDraft>;
  plan?: WorldAuthoringPlan;
  research: {
    enabled: boolean;
    available: boolean;
  };
  harness: WorldAuthoringHarnessState;
  sourceArtifacts: WorldSourceDraftArtifact[];
  lastSequence: number;
  error?: string;
}

export class AuthoringSession {
  readonly id: string;
  private acceptedDraftValue: WorldDraft;
  private workingDraftValue: WorldDraft;
  private readonly undoStack: WorldDraft[] = [];
  private readonly redoStack: WorldDraft[] = [];
  private readonly conversation: AuthoringConversationEntry[] = [];
  private planValue?: WorldAuthoringPlan;
  private planInstruction?: string;
  private taskValue?: WorldAuthoringTask;
  private readonly taskRuntime: AuthoringTaskRuntime;
  private readonly stream: AuthoringStreamChannel;
  private readonly sessionLogRuntime: AuthoringSessionLog;
  private turnCount = 0;
  private stepCount = 0;
  private modelRequestCount = 0;
  private toolCallCount = 0;
  private totalTokens = 0;
  private currentTurnId?: string;
  private lastStopReason?: WorldAuthoringHarnessState["lastStopReason"];
  private status: AuthoringSessionStatus = "idle";
  private researchEnabledValue = false;
  private error?: string;
  private lastAccessAtValue: number;
  private operation?: AbortController;
  private sourceMaterialsValue: WorldSourceMaterialDocument[] = [];
  private readonly sourceArtifactsValue: WorldSourceDraftArtifact[] = [];
  private readonly providerRuntime: ProviderRuntime;
  private activeDraftCommit?: {
    turnId: string;
    baseRevision: number;
    committedRevision: number;
    undoCaptured: boolean;
  };

  constructor(
    id: string,
    draft: WorldDraft,
    providers: ProviderPair,
    streamCacheSize: number,
    private readonly now: () => number,
    providerFactory?: ProviderFactory,
    providerConfig?: ProviderRequestConfig,
  ) {
    this.id = id;
    this.acceptedDraftValue = structuredClone(draft);
    this.workingDraftValue = structuredClone(draft);
    this.lastAccessAtValue = now();
    this.providerRuntime = new ProviderRuntime(
      providers,
      providerFactory ?? (() => providers),
      providerConfig,
    );
    this.stream = new AuthoringStreamChannel(streamCacheSize, now);
    this.sessionLogRuntime = new AuthoringSessionLog(
      now,
      (kind, data) => this.publish(kind, data),
    );
    this.taskRuntime = new AuthoringTaskRuntime({
      getPlan: () => this.planValue,
      getTask: () => this.taskValue,
      setTask: (task) => { this.taskValue = task; },
      getAcceptedRevision: () => this.acceptedDraftValue.revision,
      isSessionIdle: () => this.status === "idle",
      assertIdle: () => this.assertIdle(),
      failConflict: (message) => { throw new AuthoringConflictError(message); },
      now: () => this.now(),
      runPlanStage: (title) => this.runPlanStage(title),
      cancelOperation: () => { this.operation?.abort(); },
      publishTask: (task) => this.publish("authoring.task_changed", {
        task: task ? structuredClone(task) : null,
      }),
      publishPlan: (plan) => this.publish("authoring.plan_changed", { plan }),
    });
  }

  updateProviderConfig(config?: ProviderRequestConfig): Promise<void> {
    return this.providerRuntime.update(config);
  }

  get lastAccessAt(): number {
    return this.lastAccessAtValue;
  }

  get clientCount(): number {
    return this.stream.clientCount;
  }

  touch(): void {
    this.lastAccessAtValue = this.now();
  }

  view(): AuthoringSessionView {
    this.touch();
    return {
      id: this.id,
      status: this.status,
      acceptedDraft: structuredClone(this.acceptedDraftValue),
      workingDraft: structuredClone(this.workingDraftValue),
      task: this.taskValue ? structuredClone(this.taskValue) : undefined,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      conversation: structuredClone(this.conversation),
      validation: validateWorldDraft(this.workingDraftValue),
      plan: this.planValue ? structuredClone(this.planValue) : undefined,
      research: {
        enabled: this.researchEnabledValue,
        available: researchProviderAvailable(this.providerRuntime.providers.researchProvider),
      },
      harness: this.harnessView(),
      sourceArtifacts: structuredClone(this.sourceArtifactsValue),
      lastSequence: this.stream.lastSequence,
      error: this.error,
    };
  }

  sessionLog(afterSequence = 0, limit = 500): WorldAuthoringSessionEvent[] {
    return this.sessionLogRuntime.list(afterSequence, limit);
  }

  private harnessView(): WorldAuthoringHarnessState {
    return this.sessionLogRuntime.view({
      currentTurnId: this.currentTurnId,
      turnCount: this.turnCount,
      stepCount: this.stepCount,
      modelRequestCount: this.modelRequestCount,
      toolCallCount: this.toolCallCount,
      totalTokens: this.totalTokens,
      lastStopReason: this.lastStopReason,
    });
  }

  startTask(maxRounds?: number): AuthoringSessionView {
    this.taskRuntime.start(maxRounds);
    return this.view();
  }

  pauseTask(): AuthoringSessionView {
    this.taskRuntime.pause();
    return this.view();
  }

  resumeTask(): AuthoringSessionView {
    const result = this.taskRuntime.resume();
    if (result === "needs_start") this.taskRuntime.start();
    return this.view();
  }

  private publishTask(): void {
    const task = this.taskValue;
    this.publish("authoring.task_changed", {
      task: task ? structuredClone(task) : null,
    });
  }
  async message(
    instruction: string,
    sourceMaterials: readonly WorldSourceMaterialDocument[] = [],
  ): Promise<WorldArchitectResult> {
    this.assertIdle();
    if (this.taskValue?.status === "active") this.pauseTask();
    this.touch();
    this.sourceMaterialsValue = [...structuredClone(sourceMaterials)];
    this.conversation.push({
      id: randomUUID(),
      role: "user",
      content: instruction,
      createdAt: this.now(),
    });
    const nextPlannedItem = this.planValue?.items.find((item) => item.status === "pending");
    if (
      nextPlannedItem &&
      !this.planValue?.items.some((item) => (
        item.status === "in_progress" || item.status === "awaiting_review"
      ))
    ) {
      nextPlannedItem.status = "in_progress";
      this.publish("authoring.plan_changed", { plan: this.planValue });
    }
    const hasOpenPlan = this.planValue?.items.some((item) => (
      item.status === "pending" ||
      item.status === "in_progress" ||
      item.status === "awaiting_review"
    ));
    if (hasOpenPlan) {
      this.planInstruction = [this.planInstruction, `用户补充：${instruction}`]
        .filter(Boolean)
        .join("\n");
    } else {
      this.planValue = undefined;
      this.planInstruction = instruction;
    }
    return this.runArchitectPass(instruction);
  }

  setResearchEnabled(enabled: boolean): AuthoringSessionView {
    this.assertIdle();
    if (enabled && !researchProviderAvailable(this.providerRuntime.providers.researchProvider)) {
      throw new AuthoringConflictError("当前没有可用的联网研究模型，请先在设置中配置并测试。");
    }
    this.researchEnabledValue = enabled;
    this.publish("authoring.research_mode_changed", {
      enabled,
      available: researchProviderAvailable(this.providerRuntime.providers.researchProvider),
    });
    return this.view();
  }

  private async runArchitectPass(instruction: string): Promise<WorldArchitectResult> {
    return this.runArchitectPassInternal(instruction, this.acceptedDraftValue);
  }

  private async runArchitectPassInternal(
    instruction: string,
    passDraft: WorldDraft,
  ): Promise<WorldArchitectResult> {
    const existingPlan = this.planValue;
    const turnId = `turn:${++this.turnCount}:${randomUUID()}`;
    this.currentTurnId = turnId;
    this.activeDraftCommit = {
      turnId,
      baseRevision: passDraft.revision,
      committedRevision: passDraft.revision,
      undoCaptured: false,
    };
    this.appendSessionLog("turn.started", {
      instruction: compactText(instruction, 320),
      draftRevision: passDraft.revision,
      taskId: this.taskValue?.id,
      phase: this.taskValue?.phase,
    }, turnId);
    this.status = "running";
    this.error = undefined;
    this.publish("authoring.status", { status: this.status });
    const activeStage = this.planValue?.items.find((item) => item.status === "in_progress");
    this.publish("authoring.agent_delta", {
      delta: activeStage
        ? `正在处理：${activeStage.title}`
        : "正在理解你的想法",
      kind: "status",
    });
    const controller = new AbortController();
    this.operation = controller;
    try {
      const architect = this.createArchitect(turnId);
      const result = await architect.run({
        draft: passDraft,
        instruction,
        history: this.conversation.slice(-8).map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        plan: this.planValue,
        signal: controller.signal,
      });
      const effectiveChangeSet = result.changeSet;
      const transaction = this.activeDraftCommit;
      const incrementallyCommitted = Boolean(
        transaction && transaction.committedRevision > transaction.baseRevision,
      );
      this.planValue = result.plan ? structuredClone(result.plan) : undefined;
      const finalCommitted = effectiveChangeSet &&
        result.workingDraft.revision > this.acceptedDraftValue.revision
        ? this.commitAgentDraft({
            turnId,
            draft: result.workingDraft,
            summary: effectiveChangeSet.summary,
            operations: effectiveChangeSet.operations,
          })
        : false;
      if (!effectiveChangeSet) {
        // Research-only and conversational passes must not replace the saved draft.
        this.workingDraftValue = structuredClone(this.acceptedDraftValue);
      }
      if (effectiveChangeSet && (incrementallyCommitted || finalCommitted)) {
        const appliedPlanItem = this.planValue?.items.find((item) => (
          item.status === "awaiting_review"
        ));
        if (appliedPlanItem) appliedPlanItem.status = "completed";
      }
      const nextResult: WorldArchitectResult = {
        ...result,
        changeSet: effectiveChangeSet ? structuredClone(effectiveChangeSet) : undefined,
        plan: this.planValue ? structuredClone(this.planValue) : undefined,
      };
      if (nextResult.sourceArtifacts?.length) {
        this.sourceArtifactsValue.push(...structuredClone(nextResult.sourceArtifacts));
        this.publish("authoring.source_artifact_created", {
          artifacts: structuredClone(nextResult.sourceArtifacts),
        });
      }
      this.publish("authoring.plan_changed", {
        plan: this.planValue,
      });
      this.conversation.push({
        id: randomUUID(),
        role: "assistant",
        content: formatArchitectMarkdown(nextResult),
        createdAt: this.now(),
      });
      this.status = "idle";
      if (this.taskValue?.status === "active") {
        this.taskValue.draftRevision = this.acceptedDraftValue.revision;
        this.taskValue.updatedAt = this.now();
        this.publishTask();
      }
      this.lastStopReason = nextResult.execution.stopReason;
      this.appendSessionLog("turn.completed", {
        stopReason: nextResult.execution.stopReason,
        steps: nextResult.execution.steps,
        toolCalls: nextResult.execution.toolCalls,
        changed: Boolean(nextResult.changeSet),
        draftRevision: this.acceptedDraftValue.revision,
      }, turnId);
      this.currentTurnId = undefined;
      this.publish("authoring.agent_result", {
        summary: nextResult.summary,
        questions: nextResult.questions,
        changeSet: nextResult.changeSet,
        validation: validateWorldDraft(this.workingDraftValue),
        plan: this.planValue,
      });
      if (
        !this.taskValue &&
        this.planValue &&
        nextTaskPhase(this.planValue) &&
        (effectiveChangeSet || !existingPlan)
      ) {
        this.taskRuntime.start();
      }
      return nextResult;
    } catch (error) {
      if (controller.signal.aborted && this.taskValue?.status === "paused") {
        this.status = "idle";
        this.error = undefined;
        this.lastStopReason = "cancelled";
        this.appendSessionLog("turn.cancelled", {
          reason: "task_paused",
          draftRevision: this.acceptedDraftValue.revision,
        }, turnId);
        this.currentTurnId = undefined;
        this.publish("authoring.status", { status: this.status });
        throw error;
      }
      this.status = "error";
      this.error = errorMessage(error);
      this.lastStopReason = "failed";
      this.appendSessionLog("turn.failed", {
        error: compactText(this.error, 500),
        draftRevision: this.acceptedDraftValue.revision,
      }, turnId);
      this.currentTurnId = undefined;
      this.publish("authoring.error", { message: this.error });
      throw error;
    } finally {
      if (this.operation === controller) this.operation = undefined;
      if (this.activeDraftCommit?.turnId === turnId) this.activeDraftCommit = undefined;
    }
  }

  private createArchitect(turnId: string): WorldArchitect {
    return new WorldArchitect(
      this.providerRuntime.providers.authoringProvider ?? this.providerRuntime.providers.directorProvider,
      {
        maxToolRounds: DEFAULT_AUTHORING_MAX_TOOL_ROUNDS,
        maxTokens: DEFAULT_AUTHORING_MAX_TOKENS,
        nextId: (prefix) => `${this.acceptedDraftValue.id}:${prefix}:${randomUUID()}`,
        trace: (event) => {
          this.publish(`authoring.agent_${event.type}`, {
            round: event.round,
            ...event.payload,
          });
          this.recordHarnessTrace(turnId, event);
        },
        onTextDelta: (delta) => {
          this.publish("authoring.agent_delta", { delta });
        },
        researchProvider: researchProviderAvailable(this.providerRuntime.providers.researchProvider)
          ? this.providerRuntime.providers.researchProvider
          : undefined,
        researchEnabled: this.researchEnabledValue,
        sourceMaterials: this.sourceMaterialsValue,
        onResearchEvent: (event) => this.publishResearchEvent(event),
        onBatchCommitted: ({ draft, operations, receipt }) => {
          this.commitAgentDraft({
            turnId,
            draft,
            summary: receipt.objective,
            operations,
            receipt,
          });
        },
      },
    );
  }

  private commitAgentDraft(input: {
    turnId: string;
    draft: WorldDraft;
    summary: string;
    operations: readonly WorldDraftOperation[];
    receipt?: WorldDraftBatchReceipt;
  }): boolean {
    if (input.draft.revision <= this.acceptedDraftValue.revision) return false;
    const transaction = this.activeDraftCommit;
    if (!transaction || transaction.turnId !== input.turnId) {
      throw new AuthoringConflictError("创作提交已脱离当前会话回合。");
    }
    if (!transaction.undoCaptured) {
      this.undoStack.push(structuredClone(this.acceptedDraftValue));
      this.redoStack.length = 0;
      transaction.undoCaptured = true;
    }
    this.acceptedDraftValue = {
      ...structuredClone(input.draft),
      lastChangeSummary: input.summary,
    };
    this.workingDraftValue = structuredClone(this.acceptedDraftValue);
    transaction.committedRevision = this.acceptedDraftValue.revision;
    if (input.receipt) {
      this.publish("authoring.draft_changed", {
        action: "agent_batch",
        revision: input.receipt.revision,
        acceptedDraft: structuredClone(this.acceptedDraftValue),
        batch: structuredClone(input.receipt),
      });
      this.appendSessionLog("draft.committed", {
        batchId: input.receipt.id,
        objective: input.receipt.objective,
        scope: input.receipt.scope,
        revision: input.receipt.revision,
        operationCount: input.operations.length,
        operationTypes: input.receipt.operationTypes,
        validationDelta: input.receipt.validationDelta,
      }, input.turnId);
    } else {
      this.publish("authoring.draft_changed", {
        action: "agent",
        revision: this.acceptedDraftValue.revision,
        acceptedDraft: structuredClone(this.acceptedDraftValue),
        summary: input.summary,
      });
      this.appendSessionLog("draft.committed", {
        revision: this.acceptedDraftValue.revision,
        operationCount: input.operations.length,
        operationTypes: [...new Set(input.operations.map((operation) => operation.type))],
        summary: compactText(input.summary, 320),
      }, input.turnId);
    }
    return true;
  }

  consumeSourceArtifact(artifactId: string): AuthoringSessionView {
    this.assertIdle();
    const index = this.sourceArtifactsValue.findIndex((artifact) => artifact.id === artifactId);
    if (index < 0) throw new AuthoringConflictError("待保存的 Markdown 资料不存在或已处理。");
    this.sourceArtifactsValue.splice(index, 1);
    this.publish("authoring.source_artifact_consumed", { artifactId });
    return this.view();
  }

  private recordHarnessTrace(
    turnId: string,
    event: WorldArchitectTrace,
  ): void {
    recordAuthoringTrace({
      appendSessionLog: (type, data, id, step) => this.appendSessionLog(type, data, id, step),
      publish: (kind, data) => this.publish(kind, data),
      incrementStep: () => { this.stepCount++; },
      incrementModelRequest: () => { this.modelRequestCount++; },
      incrementToolCall: () => { this.toolCallCount++; },
      addTokens: (tokens) => { this.totalTokens += tokens; },
    }, turnId, event);
  }

  private appendSessionLog(
    type: WorldAuthoringSessionEventType,
    data: Record<string, unknown>,
    turnId: string,
    step?: number,
  ): void {
    this.sessionLogRuntime.append(type, data, turnId, step);
  }

  private publishResearchEvent(event: WorldResearchEvent): void {
    const streamEvent = publishResearchStreamEvent(event);
    this.publish(streamEvent.kind, streamEvent.data);
  }

  private async runPlanStage(title: string): Promise<WorldArchitectResult> {
    if (!this.planInstruction) {
      throw new AuthoringConflictError("当前没有可执行的创作计划目标。");
    }
    return this.runArchitectPass([
      `继续执行既定创作计划的当前阶段：${title}。`,
      `原始创作目标：${this.planInstruction}`,
      "完成当前阶段后直接把有效修改写入草稿；不要为了继续计划而重复没有新价值的操作。",
    ].join("\n"));
  }

  applyManualOperations(input: {
    baseRevision: number;
    operations: readonly WorldDraftOperation[];
    summary?: string;
  }): AuthoringSessionView {
    this.assertIdle();
    if (input.operations.length === 0) {
      throw new AuthoringConflictError("没有需要保存的手动修改。");
    }
    let next: WorldDraft;
    try {
      next = applyWorldDraftOperations(
        this.acceptedDraftValue,
        input.operations,
        {
          expectedRevision: input.baseRevision,
          idGenerator: (prefix) => `${this.acceptedDraftValue.id}:${prefix}:${randomUUID()}`,
          lastChangeSummary: input.summary || "手动编辑草稿",
        },
      );
    } catch (error) {
      if (error instanceof WorldDraftOperationError || error instanceof WorldDraftRevisionError) {
        throw new AuthoringConflictError(error.message);
      }
      throw error;
    }
    this.undoStack.push(structuredClone(this.acceptedDraftValue));
    this.redoStack.length = 0;
    this.acceptedDraftValue = next;
    this.workingDraftValue = structuredClone(next);
    this.status = "idle";
    this.error = undefined;
    if (this.taskValue && this.taskValue.status !== "completed") {
      this.taskValue.status = "paused";
      this.taskValue.draftRevision = next.revision;
      this.taskValue.updatedAt = this.now();
      this.taskValue.lastError = "手动编辑已修改草稿版本，长期任务已暂停。";
      this.taskRuntime.cancelPending();
      this.publishTask();
    }
    this.publish("authoring.draft_changed", {
      action: "manual",
      revision: next.revision,
      acceptedDraft: structuredClone(next),
    });
    return this.view();
  }

  undo(): AuthoringSessionView {
    this.assertIdle();
    const previous = this.undoStack.pop();
    if (!previous) throw new AuthoringConflictError("没有可以撤销的修改。");
    this.redoStack.push(structuredClone(this.acceptedDraftValue));
    this.acceptedDraftValue = restoreAsNewRevision(
      previous,
      this.acceptedDraftValue.revision + 1,
      "撤销上一轮修改",
    );
    this.workingDraftValue = structuredClone(this.acceptedDraftValue);
    this.status = "idle";
    this.error = undefined;
    this.publish("authoring.draft_changed", {
      action: "undo",
      revision: this.acceptedDraftValue.revision,
      acceptedDraft: structuredClone(this.acceptedDraftValue),
    });
    return this.view();
  }

  redo(): AuthoringSessionView {
    this.assertIdle();
    const next = this.redoStack.pop();
    if (!next) throw new AuthoringConflictError("没有可以重做的修改。");
    this.undoStack.push(structuredClone(this.acceptedDraftValue));
    this.acceptedDraftValue = restoreAsNewRevision(
      next,
      this.acceptedDraftValue.revision + 1,
      "重做上一轮修改",
    );
    this.workingDraftValue = structuredClone(this.acceptedDraftValue);
    this.status = "idle";
    this.error = undefined;
    this.publish("authoring.draft_changed", {
      action: "redo",
      revision: this.acceptedDraftValue.revision,
      acceptedDraft: structuredClone(this.acceptedDraftValue),
    });
    return this.view();
  }

  async preview(
    playerMessage?: string,
    sourceProvider?: WorldSourceProvider,
  ): Promise<AuthoringPreviewResult> {
    this.assertIdle();
    const validation = validateWorldDraft(this.workingDraftValue);
    if (!validation.valid) {
      throw new AuthoringValidationError(validation);
    }
    this.status = "previewing";
    this.error = undefined;
    this.publish("authoring.status", { status: this.status });
    const controller = new AbortController();
    this.operation = controller;
    try {
      const result = await runPreview({
        draft: this.workingDraftValue,
        providers: this.providerRuntime.providers,
        playerMessage,
        sourceProvider,
        signal: controller.signal,
      });
      this.status = "idle";
      this.publish("authoring.preview_completed", { preview: result });
      return result;
    } catch (error) {
      this.status = "error";
      this.error = errorMessage(error);
      this.publish("authoring.error", { message: this.error });
      throw error;
    } finally {
      if (this.operation === controller) this.operation = undefined;
    }
  }

  attachStream(response: ServerResponse, afterSequence: number): void {
    this.touch();
    this.stream.attach(response, afterSequence);
  }

  close(): void {
    this.taskRuntime.close();
    this.operation?.abort();
    this.operation = undefined;
    this.stream.close();
  }

  private publish(kind: AuthoringStreamKind, data?: Record<string, unknown>): void {
    this.stream.publish(kind, data);
  }

  private assertIdle(): void {
    if (this.status === "running" || this.status === "previewing") {
      throw new AuthoringConflictError("创作会话正在处理其他任务。");
    }
  }

}

export class AuthoringConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoringConflictError";
  }
}

export class AuthoringCapacityError extends Error {
  constructor() {
    super("Authoring session capacity reached.");
    this.name = "AuthoringCapacityError";
  }
}

export class AuthoringValidationError extends Error {
  constructor(readonly validation: ReturnType<typeof validateWorldDraft>) {
    super("WorldDraft validation failed.");
    this.name = "AuthoringValidationError";
  }
}

function researchProviderAvailable(
  provider: ProviderPair["researchProvider"],
): boolean {
  if (!provider) return false;
  const availability = (provider as { available?: unknown }).available;
  return availability !== false;
}
