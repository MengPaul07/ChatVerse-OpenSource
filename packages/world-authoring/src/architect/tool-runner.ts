import type {
  TokenUsage,
  ToolCall,
  WebResearchProvider,
} from "@chatverse/core";
import {
  applyWorldDraftOperations,
  WorldDraftOperationError,
  WorldDraftRevisionError,
  type DraftIdGenerator,
} from "../draft.js";
import type {
  DraftResearchSource,
  WorldAuthoringPlan,
  WorldDraft,
  WorldDraftBatchCommit,
  WorldDraftBatchReceipt,
  WorldDraftOperation,
  WorldResearchEvent,
  WorldSourceDraftArtifact,
  WorldSourceMaterialDocument,
} from "../types.js";
import { validateWorldDraft } from "../validation.js";
import {
  activePlanItem,
  AuthoringToolInputError,
  isDraftMutationTool,
  parseArgs,
  parseAuthoringPlan,
  parseOperations,
  requiredRecord,
  requiredString,
  stringArray,
} from "./tools/parsing.js";
import {
  inspectDraft,
} from "../draft/inspection.js";
import { batchScope, createBatchReceipt } from "../draft/operations.js";
import {
  inspectSourceMaterials,
  parseSourceArtifact,
  readSourceMaterial,
} from "../sources/materials.js";

export interface AuthoringToolContext {
  getWorkingDraft(): WorldDraft;
  setWorkingDraft(value: WorldDraft): void;
  operations: WorldDraftOperation[];
  batchReceipts: WorldDraftBatchReceipt[];
  nextId: DraftIdGenerator;
  getPlan(): WorldAuthoringPlan | undefined;
  setPlan(value: WorldAuthoringPlan): void;
  researchProvider?: WebResearchProvider;
  researchEnabled: boolean;
  researchSources: DraftResearchSource[];
  signal?: AbortSignal;
  onResearchEvent?: (event: WorldResearchEvent) => void;
  onResearchUsage?: (usage: TokenUsage) => void;
  sourceMaterials: readonly WorldSourceMaterialDocument[];
  sourceArtifacts: WorldSourceDraftArtifact[];
  onBatchCommitted?: (commit: WorldDraftBatchCommit) => void | Promise<void>;
}

export async function executeAuthoringTool(
  call: ToolCall,
  context: AuthoringToolContext,
): Promise<{
  ok: boolean;
  payload: Record<string, unknown>;
  finish?: { summary: string; questions: string[] };
}> {
  try {
    const args = parseArgs(call);
    switch (call.function.name) {
      case "inspect_draft":
        return {
          ok: true,
          payload: inspectDraft(
            context.getWorkingDraft(),
            stringArray(args.sections),
            stringArray(args.ids),
          ),
        };
      case "inspect_source_materials":
        return {
          ok: true,
          payload: inspectSourceMaterials(context.sourceMaterials, args),
        };
      case "read_source_material":
        return {
          ok: true,
          payload: readSourceMaterial(context.sourceMaterials, args),
        };
      case "write_source_documents": {
        const artifact = parseSourceArtifact(args, context);
        const existingDocumentCount = context.sourceArtifacts.reduce(
          (sum, current) => sum + current.documents.length,
          0,
        );
        const existingCharacterCount = context.sourceArtifacts.reduce(
          (sum, current) => sum + current.documents.reduce(
            (documentSum, document) => documentSum + document.content.length,
            0,
          ),
          0,
        );
        const artifactCharacterCount = artifact.documents.reduce(
          (sum, document) => sum + document.content.length,
          0,
        );
        if (
          context.sourceArtifacts.length >= 4
          || existingDocumentCount + artifact.documents.length > 16
          || existingCharacterCount + artifactCharacterCount > 64_000
        ) {
          throw new Error(
            "本轮 Markdown 资料预算已用完（最多 4 份资料源、16 篇文档、64000 字符）。已成功写入的资料会保留；请结束本轮后再继续。",
          );
        }
        context.sourceArtifacts.push(artifact);
        return {
          ok: true,
          payload: {
            artifactId: artifact.id,
            mode: artifact.mode,
            bundleId: artifact.bundleId,
            revision: artifact.revision,
            documentCount: artifact.documents.length,
            totalChars: artifact.documents.reduce((sum, document) => sum + document.content.length, 0),
          },
        };
      }
      case "research_web": {
        if (!context.researchEnabled || !context.researchProvider) {
          return {
            ok: false,
            payload: { error: "联网创作当前未开启或联网模型不可用。" },
          };
        }
        const query = requiredString(args.query, "query").slice(0, 300);
        const purpose = requiredString(args.purpose, "purpose").slice(0, 300);
        context.onResearchEvent?.({ type: "started", query, purpose });
        let usage: TokenUsage | undefined;
        try {
          const result = await context.researchProvider.search({
            query,
            purpose,
            signal: context.signal,
            requestContext: { purpose: "world_authoring_research" },
            onUsage: (next) => {
              usage = next;
              context.onResearchUsage?.(next);
            },
          });
          const knownUrls = new Set(context.researchSources.map((source) => source.url));
          const sources = result.sources
            .filter((source) => {
              if (knownUrls.has(source.url)) return false;
              knownUrls.add(source.url);
              return true;
            })
            .slice(0, Math.max(0, 50 - context.researchSources.length))
            .map((source) => ({
              ...source,
              id: context.nextId("source"),
            }));
          context.researchSources.push(...sources);
          context.onResearchEvent?.({
            type: "completed",
            query,
            sourceCount: sources.length,
            sources: structuredClone(sources),
            usage,
          });
          return {
            ok: true,
            payload: {
              summary: result.summary.slice(0, 1500),
              sources: sources.map(({ id, title, url, note }) => ({ id, title, url, note })),
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          context.onResearchEvent?.({ type: "failed", query, error: message });
          return { ok: false, payload: { error: `联网检索失败：${message}` } };
        }
      }
      case "write_authoring_plan": {
        const plan = parseAuthoringPlan(args, context.nextId);
        context.setPlan(plan);
        return {
          ok: true,
          payload: { plan },
        };
      }
      case "update_world_core": {
        const operations: WorldDraftOperation[] = [];
        if (args.metadata !== undefined) {
          operations.push({
            type: "set_metadata",
            metadata: requiredRecord(args.metadata, "metadata"),
          });
        }
        if (args.premise !== undefined) {
          operations.push({
            type: "set_premise",
            premise: requiredString(args.premise, "premise"),
          });
        }
        if (args.lore !== undefined) {
          operations.push({
            type: "set_lore",
            lore: requiredRecord(args.lore, "lore"),
          });
        }
        if (operations.length === 0) {
          throw new AuthoringToolInputError(
            "invalid_tool_arguments",
            "update_world_core 至少需要 metadata、premise 或 lore 之一。",
          );
        }
        return commitDraftOperations(context, "更新世界核心", operations);
      }
      case "save_player_card":
        return commitDraftOperations(context, "保存玩家角色卡", [{
          type: "upsert_player",
          player: requiredRecord(args.player, "player"),
        }]);
      case "save_actor": {
        const actor = requiredRecord(args.actor, "actor");
        const card = requiredRecord(actor.card, "actor.card");
        const name = typeof card.name === "string" ? card.name.trim() : "角色";
        return commitDraftOperations(context, `保存角色：${name || "角色"}`, [{
          type: "upsert_actor",
          actor: { ...actor, card },
        }]);
      }
      case "save_relations": {
        if (!Array.isArray(args.relations) || args.relations.length < 1 || args.relations.length > 6) {
          throw new AuthoringToolInputError(
            "invalid_tool_arguments",
            "relations 必须包含 1 到 6 条关系。",
          );
        }
        return commitDraftOperations(
          context,
          "保存角色关系",
          args.relations.map((relation) => ({
            type: "upsert_relation" as const,
            relation: requiredRecord(relation, "relation"),
          })),
        );
      }
      case "save_context":
        return commitDraftOperations(context, "保存开场 Context", [{
          type: "upsert_context",
          context: requiredRecord(args.context, "context"),
        }]);
      case "save_chapter":
        return commitDraftOperations(context, "保存章节", [{
          type: "upsert_chapter",
          chapter: requiredRecord(args.chapter, "chapter"),
        }]);
      case "remove_draft_entities": {
        const operations: WorldDraftOperation[] = [
          ...stringArray(args.relationIds).map((relationId): WorldDraftOperation => ({
            type: "remove_relation",
            relationId,
          })),
          ...stringArray(args.chapterIds).map((chapterId): WorldDraftOperation => ({
            type: "remove_chapter",
            chapterId,
          })),
          ...stringArray(args.actorIds).map((actorId): WorldDraftOperation => ({
            type: "remove_actor",
            actorId,
          })),
          ...(args.removePlayer === true ? [{ type: "remove_player" as const }] : []),
        ];
        if (operations.length === 0) {
          throw new AuthoringToolInputError(
            "invalid_tool_arguments",
            "remove_draft_entities 至少需要一个待删除实体。",
          );
        }
        return commitDraftOperations(context, "删除草稿实体", operations);
      }
      case "set_runtime_profile":
        return commitDraftOperations(context, "更新运行模式", [{
          type: "set_runtime_profile",
          runtimeProfile: requiredString(args.runtimeProfile, "runtimeProfile") as "world_story" | "group_chat",
        }]);
      case "validate_draft":
        return {
          ok: true,
          payload: {
            revision: context.getWorkingDraft().revision,
            validation: validateWorldDraft(context.getWorkingDraft()),
          },
        };
      case "finish": {
        const finish = {
          summary: requiredString(args.summary, "summary"),
          questions: stringArray(args.questions).slice(0, 3),
        };
        const validation = validateWorldDraft(context.getWorkingDraft());
        const errors = validation.issues.filter((issue) => issue.severity === "error");
        const plan = context.getPlan();
        const currentStage = activePlanItem(plan);
        if (
          context.operations.length > 0
          && errors.length > 0
          && finish.questions.length === 0
          && !currentStage
        ) {
          return {
            ok: false,
            payload: {
              finished: false,
              error: "当前草稿仍不可运行。请集中补齐以下缺口，重新校验后再 finish。",
              validation: { valid: false, issues: errors },
            },
          };
        }
        return { ok: true, payload: { finished: true }, finish };
      }
      default:
        return { ok: false, payload: { error: `未知工具：${call.function.name}` } };
    }
  } catch (error) {
    const inputError = error instanceof AuthoringToolInputError
      ? error
      : isDraftMutationTool(call.function.name)
        && !(error instanceof WorldDraftOperationError)
        && !(error instanceof WorldDraftRevisionError)
        ? new AuthoringToolInputError(
            "invalid_tool_arguments",
            error instanceof Error ? error.message : String(error),
          )
        : undefined;
    const known = error instanceof WorldDraftOperationError ||
      error instanceof WorldDraftRevisionError ||
      error instanceof Error;
    return {
      ok: false,
      payload: {
        error: known ? error.message : String(error),
        ...(inputError ? { errorType: inputError.type } : {}),
        revision: context.getWorkingDraft().revision,
        ...(inputError
          ? { retry: "只修正当前工具调用；不要重复已成功的读取、检索或写入。" }
          : {}),
      },
    };
  }
}

async function commitDraftOperations(
  context: AuthoringToolContext,
  objective: string,
  operations: readonly unknown[],
): Promise<{
  ok: boolean;
  payload: Record<string, unknown>;
}> {
  const incoming = parseOperations(operations);
  if (context.operations.length + incoming.length > 48) {
    throw new WorldDraftOperationError("本轮累计修改不能超过 48 个操作；请结束当前阶段并在下一轮继续。");
  }
  const previous = context.getWorkingDraft();
  const validationBefore = validateWorldDraft(previous);
  let normalizedOperations: WorldDraftOperation[] = [];
  const next = applyWorldDraftOperations(previous, incoming, {
    expectedRevision: previous.revision,
    idGenerator: context.nextId,
    captureOperations: (normalized) => {
      normalizedOperations = normalized;
    },
  });
  const validation = validateWorldDraft(next);
  const receipt = createBatchReceipt({
    id: context.nextId("batch"),
    objective: objective.slice(0, 200),
    scope: batchScope(incoming),
    previous,
    next,
    operations: normalizedOperations,
    validationBefore,
    validation,
  });
  await context.onBatchCommitted?.({
    draft: structuredClone(next),
    operations: structuredClone(normalizedOperations),
    receipt: structuredClone(receipt),
  });
  context.operations.push(...normalizedOperations);
  context.batchReceipts.push(receipt);
  context.setWorkingDraft(next);
  const active = activePlanItem(context.getPlan());
  if (active) active.status = "awaiting_review";
  return {
    ok: true,
    payload: {
      batch: receipt,
      applied: normalizedOperations.length,
      idMappings: createIdMappings(incoming, normalizedOperations),
      revision: next.revision,
      validation,
      planItem: active,
    },
  };
}

function createIdMappings(
  incoming: readonly WorldDraftOperation[],
  normalized: readonly WorldDraftOperation[],
): Array<Record<string, string>> {
  return normalized.flatMap((operation, index) => {
    const original = incoming[index];
    if (!original || operation.type !== original.type) return [];

    switch (operation.type) {
      case "upsert_player": {
        const actualId = operation.player.id;
        if (!actualId) return [];
        return [{
          kind: "player",
          actualId,
          ...(original.type === "upsert_player" && original.player.id
            ? { requestedId: original.player.id }
            : {}),
          ...(operation.player.profile?.name ? { name: operation.player.profile.name } : {}),
        }];
      }
      case "upsert_actor": {
        const actualId = operation.actor.id;
        if (!actualId) return [];
        return [{
          kind: "actor",
          actualId,
          ...(original.type === "upsert_actor" && original.actor.id
            ? { requestedId: original.actor.id }
            : {}),
          ...(operation.actor.card?.name ? { name: operation.actor.card.name } : {}),
        }];
      }
      case "upsert_context": {
        const actualId = operation.context.id;
        if (!actualId) return [];
        return [{
          kind: "context",
          actualId,
          ...(original.type === "upsert_context" && original.context.id
            ? { requestedId: original.context.id }
            : {}),
          ...(operation.context.name ? { name: operation.context.name } : {}),
        }];
      }
      case "upsert_relation": {
        const actualId = operation.relation.id;
        if (!actualId) return [];
        return [{
          kind: "relation",
          actualId,
          ...(original.type === "upsert_relation" && original.relation.id
            ? { requestedId: original.relation.id }
            : {}),
        }];
      }
      case "upsert_chapter": {
        const actualId = operation.chapter.id;
        if (!actualId) return [];
        return [{
          kind: "chapter",
          actualId,
          ...(original.type === "upsert_chapter" && original.chapter.id
            ? { requestedId: original.chapter.id }
            : {}),
          ...(operation.chapter.title ? { name: operation.chapter.title } : {}),
        }];
      }
      default:
        return [];
    }
  });
}
