import type {
  GroupCard,
  WorldActorDefinition,
  WorldArchive,
  WorldDefinition,
  WorldRelation,
} from "@chatverse/core";
import {
  validateWorldDraft,
  type WorldDraft,
  type WorldDraftOperation,
  type WorldSourceMaterialDocument,
} from "@chatverse/world-authoring";
import {
  InMemoryWorldSourceProvider,
  assertValidWorldSourceBundle,
  type WorldSourceBundle,
} from "@chatverse/world-source";
import { HttpError } from "./errors.js";

export const MAX_SOURCE_BUNDLES = 8;
export const MAX_SOURCE_DOCUMENTS = 128;
export const MAX_SOURCE_CHUNKS = 5_000;
export const MAX_SOURCE_TEXT_CHARS = 5_000_000;

export async function readJson(
  request: AsyncIterable<Buffer | string>,
  maxBytes = 512 * 1024,
): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new HttpError(413, "request_too_large", `请求内容超过 ${Math.round(maxBytes / 1024 / 1024 * 10) / 10}MB。`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object.");
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid_json", "请求体必须是合法 JSON object。");
  }
}

export function worldArchive(value: unknown): WorldArchive {
  const candidate = objectRecord(value, "archive") as Partial<WorldArchive>;
  if (candidate.schemaVersion !== 1) throw new HttpError(400, "unsupported_archive_version", "只支持 schemaVersion=1 的世界存档。");
  const archiveId = requiredString(candidate.archiveId, "archive.archiveId", 160);
  const worldId = requiredString(candidate.worldId, "archive.worldId", 160);
  const definition = objectRecord(candidate.definition, "archive.definition") as unknown as WorldArchive["definition"];
  const snapshot = objectRecord(candidate.snapshot, "archive.snapshot") as unknown as WorldArchive["snapshot"];
  const metadata = objectRecord(candidate.metadata, "archive.metadata") as unknown as WorldArchive["metadata"];
  if (!definition.metadata || typeof definition.metadata !== "object" || !Array.isArray(definition.actors) || !Array.isArray(definition.contexts)) {
    throw new HttpError(400, "invalid_world_archive", "存档中的 WorldDefinition 不完整。");
  }
  if (definition.metadata.id !== worldId || snapshot.worldId !== worldId) {
    throw new HttpError(400, "archive_world_mismatch", "存档的 worldId、定义与 Snapshot 不一致。");
  }
  if (
    snapshot.schemaVersion !== 7 || typeof snapshot.worldTime !== "number" || typeof snapshot.eventSequence !== "number" ||
    typeof snapshot.directorCursor !== "number" || typeof snapshot.timestamp !== "number" || !Array.isArray(snapshot.events) ||
    !Array.isArray(snapshot.actorStates) || !Array.isArray(snapshot.actorBackgrounds) || !Array.isArray(snapshot.actorControls) ||
    !Array.isArray(snapshot.dynamicActors) || !Array.isArray(snapshot.dynamicRelations) || !Array.isArray(snapshot.actorMemories) ||
    !Array.isArray(snapshot.actorMemoryRuntime) || !Array.isArray(snapshot.presences) || !Array.isArray(snapshot.contexts) ||
    !Array.isArray(snapshot.contextSessions) || !snapshot.narrative || !Array.isArray(snapshot.narrative.beats) ||
    !Array.isArray(snapshot.narrative.edges) || !Array.isArray(snapshot.narrative.chapters)
  ) {
    throw new HttpError(400, "invalid_world_archive", "存档中的 WorldSnapshot 不完整或版本不受支持。");
  }
  if (typeof metadata.createdAt !== "number" || typeof metadata.updatedAt !== "number" || typeof metadata.eventSequence !== "number" || metadata.eventSequence !== snapshot.eventSequence) {
    throw new HttpError(400, "invalid_world_archive", "存档元数据与 Snapshot 不一致。");
  }
  if (definition.actors.length > 64 || snapshot.dynamicActors.length > 64) {
    throw new HttpError(400, "invalid_world_archive", "存档中的 Actor 数量超出限制。");
  }
  return structuredClone({ schemaVersion: 1, archiveId, worldId, definition, snapshot, metadata });
}

export function worldSourceProvider(value: unknown): InMemoryWorldSourceProvider | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SOURCE_BUNDLES) {
    throw new HttpError(400, "invalid_world_sources", `sources.bundles 必须是不超过 ${MAX_SOURCE_BUNDLES} 项的数组。`);
  }
  const bundles: WorldSourceBundle[] = [];
  let documentCount = 0;
  let chunkCount = 0;
  let textChars = 0;
  for (const [index, candidate] of value.entries()) {
    try {
      assertValidWorldSourceBundle(candidate as WorldSourceBundle);
    } catch (error) {
      throw new HttpError(400, "invalid_world_sources", `sources.bundles[${index}] 无效：${error instanceof Error ? error.message : String(error)}`);
    }
    const bundle = candidate as WorldSourceBundle;
    documentCount += bundle.documents.length;
    chunkCount += bundle.chunks.length;
    textChars += bundle.documents.reduce((sum, document) => sum + document.text.length, 0);
    if (documentCount > MAX_SOURCE_DOCUMENTS || chunkCount > MAX_SOURCE_CHUNKS || textChars > MAX_SOURCE_TEXT_CHARS) {
      throw new HttpError(413, "world_sources_too_large", "世界资料源超过当前单房间限制。");
    }
    bundles.push(bundle);
  }
  return bundles.length > 0 ? new InMemoryWorldSourceProvider({ bundles }) : undefined;
}

export function assertWorldSourcesAvailable(definition: WorldDefinition, sourceProvider: InMemoryWorldSourceProvider | undefined): void {
  const bindings = definition.sources ?? [];
  if (bindings.length === 0) return;
  if (!sourceProvider) throw new HttpError(400, "world_sources_missing", "当前世界绑定了资料源，但请求没有携带对应版本。");
  const errors = sourceProvider.validate(bindings);
  if (errors.length > 0) throw new HttpError(400, "world_sources_mismatch", `资料源版本不匹配：${errors.join("；")}`);
}

export function groupCard(value: unknown): GroupCard {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "invalid_group", "group 必须是 GroupCard object。");
  const candidate = value as Partial<GroupCard>;
  if (candidate.kind !== "chatverse.group" || candidate.schemaVersion !== 1 || !candidate.metadata || typeof candidate.metadata !== "object" || !candidate.scene || typeof candidate.scene !== "object" || !Array.isArray(candidate.characters)) {
    throw new HttpError(400, "invalid_group", "GroupCard 结构或版本无效。");
  }
  if (candidate.characters.length > 64) throw new HttpError(400, "invalid_group", "单个群最多包含 64 个角色。");
  return candidate as GroupCard;
}

export function worldDraft(value: unknown, requireRunnable = true): WorldDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "invalid_world_draft", "draft 必须是 WorldDraft object。");
  const candidate = value as Partial<WorldDraft>;
  if (candidate.schemaVersion !== 1 || typeof candidate.id !== "string" || typeof candidate.revision !== "number" || !candidate.metadata || !Array.isArray(candidate.actors) || !Array.isArray(candidate.contexts) || !Array.isArray(candidate.relations) || !Array.isArray(candidate.chapters)) {
    throw new HttpError(400, "invalid_world_draft", "WorldDraft 缺少必要字段或版本不受支持。");
  }
  const draft = structuredClone(candidate as WorldDraft);
  if (JSON.stringify(draft).length > 400_000) throw new HttpError(413, "world_draft_too_large", "WorldDraft 不能超过 400KB。");
  if (draft.actors.length > 64) throw new HttpError(400, "invalid_world_draft", "单个世界最多包含 64 个 Actor。");
  if (requireRunnable) {
    const validation = validateWorldDraft(draft);
    if (!validation.valid) throw new HttpError(400, "world_draft_validation_failed", validation.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("；"));
  }
  return draft;
}

export function draftRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpError(400, "invalid_request", "baseRevision 必须是非负整数。");
  return value as number;
}

export function sourceMaterials(value: unknown): WorldSourceMaterialDocument[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SOURCE_DOCUMENTS) throw new HttpError(400, "invalid_source_materials", `sourceMaterials 最多包含 ${MAX_SOURCE_DOCUMENTS} 篇文档。`);
  let totalChars = 0;
  return value.map((candidate, index) => {
    const item = objectRecord(candidate, `sourceMaterials[${index}]`);
    const content = requiredString(item.content, `sourceMaterials[${index}].content`, MAX_SOURCE_TEXT_CHARS);
    totalChars += content.length;
    if (totalChars > MAX_SOURCE_TEXT_CHARS) throw new HttpError(413, "source_materials_too_large", "创作素材正文总量不能超过 500 万字符。");
    return {
      bundleId: requiredString(item.bundleId, `sourceMaterials[${index}].bundleId`, 240), revision: draftRevision(item.revision),
      origin: enumString(item.origin, `sourceMaterials[${index}].origin`, ["user_import", "architect"] as const),
      documentId: requiredString(item.documentId, `sourceMaterials[${index}].documentId`, 240), path: requiredString(item.path, `sourceMaterials[${index}].path`, 500),
      title: requiredString(item.title, `sourceMaterials[${index}].title`, 240), content,
    };
  });
}

export function draftOperations(value: unknown): WorldDraftOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) throw new HttpError(400, "invalid_request", "operations 必须是 1 到 12 项的数组。");
  return value.map((value, index) => {
    const operation = operationRecord(value, `operations[${index}]`);
    const type = requiredString(operation.type, `operations[${index}].type`, 40) as WorldDraftOperation["type"];
    switch (type) {
      case "set_metadata": return { type, metadata: operationRecord(operation.metadata, `${type}.metadata`) } as WorldDraftOperation;
      case "set_premise": return { type, premise: requiredString(operation.premise, `${type}.premise`, 20_000) };
      case "set_lore": return { type, lore: operationRecord(operation.lore, `${type}.lore`) } as WorldDraftOperation;
      case "upsert_player": {
        const player = operationRecord(operation.player, `${type}.player`); optionalOperationString(player.id, `${type}.player.id`); return { type, player } as WorldDraftOperation;
      }
      case "remove_player": return { type };
      case "upsert_actor": {
        const actor = operationRecord(operation.actor, `${type}.actor`); optionalOperationString(actor.id, `${type}.actor.id`);
        if (actor.role !== undefined && actor.role !== "lead" && actor.role !== "support") throw new HttpError(400, "invalid_request", `${type}.actor.role 不合法。`);
        optionalOperationString(actor.background, `${type}.actor.background`, 20_000);
        return { type, actor: { ...actor, card: operationRecord(actor.card, `${type}.actor.card`) } } as unknown as WorldDraftOperation;
      }
      case "remove_actor": return { type, actorId: requiredString(operation.actorId, `${type}.actorId`, 160) };
      case "upsert_relation": {
        const relation = operationRecord(operation.relation, `${type}.relation`); optionalOperationString(relation.id, `${type}.relation.id`);
        return { type, relation: { ...relation, fromActorId: requiredString(relation.fromActorId, `${type}.relation.fromActorId`, 160), toActorId: requiredString(relation.toActorId, `${type}.relation.toActorId`, 160), description: requiredString(relation.description, `${type}.relation.description`, 2_000) } } as unknown as WorldDraftOperation;
      }
      case "remove_relation": return { type, relationId: requiredString(operation.relationId, `${type}.relationId`, 160) };
      case "upsert_context": {
        const context = operationRecord(operation.context, `${type}.context`); optionalOperationString(context.id, `${type}.context.id`);
        const actorIds = optionalOperationStringArray(context.actorIds, `${type}.context.actorIds`); const scene = operationRecord(context.scene, `${type}.context.scene`);
        return { type, context: { ...context, ...(actorIds ? { actorIds } : {}), name: requiredString(context.name, `${type}.context.name`, 160), scene, opening: requiredString(context.opening, `${type}.context.opening`, 20_000) } } as unknown as WorldDraftOperation;
      }
      case "upsert_chapter": {
        const chapter = operationRecord(operation.chapter, `${type}.chapter`); optionalOperationString(chapter.id, `${type}.chapter.id`);
        const actorIds = optionalOperationStringArray(chapter.actorIds, `${type}.chapter.actorIds`); const contextIds = optionalOperationStringArray(chapter.contextIds, `${type}.chapter.contextIds`);
        return { type, chapter: { ...chapter, ...(actorIds ? { actorIds } : {}), ...(contextIds ? { contextIds } : {}), title: requiredString(chapter.title, `${type}.chapter.title`, 240), treatment: requiredString(chapter.treatment, `${type}.chapter.treatment`, 30_000), targetOutcome: requiredString(chapter.targetOutcome, `${type}.chapter.targetOutcome`, 4_000) } } as unknown as WorldDraftOperation;
      }
      case "remove_chapter": return { type, chapterId: requiredString(operation.chapterId, `${type}.chapterId`, 160) };
      case "set_sources": {
        if (!Array.isArray(operation.sources) || operation.sources.length > MAX_SOURCE_BUNDLES) throw new HttpError(400, "invalid_request", `set_sources.sources 必须是不超过 ${MAX_SOURCE_BUNDLES} 项的数组。`);
        const seen = new Set<string>();
        const sources = operation.sources.map((candidate, sourceIndex) => {
          const binding = operationRecord(candidate, `${type}.sources[${sourceIndex}]`); const bundleId = requiredString(binding.bundleId, `${type}.sources[${sourceIndex}].bundleId`, 200); const revision = requiredNumber(binding.revision, `${type}.sources[${sourceIndex}].revision`);
          if (!Number.isSafeInteger(revision) || revision < 1) throw new HttpError(400, "invalid_request", `${type}.sources[${sourceIndex}].revision 必须是正整数。`);
          const fidelity = enumString(binding.fidelity, `${type}.sources[${sourceIndex}].fidelity`, ["strict", "reference", "free"] as const); const key = `${bundleId}@${revision}`;
          if (seen.has(key)) throw new HttpError(400, "invalid_request", `资料源绑定重复：${key}。`); seen.add(key); return { bundleId, revision, fidelity };
        });
        return { type, sources };
      }
      case "set_runtime_profile": return { type, runtimeProfile: enumString(operation.runtimeProfile, `${type}.runtimeProfile`, ["world_story", "group_chat"] as const) };
      default: throw new HttpError(400, "invalid_request", `不支持的草稿操作：${type}。`);
    }
  });
}

export function worldActorDefinition(value: unknown): WorldActorDefinition {
  const candidate = objectRecord(value, "actor"); const id = requiredString(candidate.id, "actor.id", 160);
  if (candidate.kind !== "character") throw new HttpError(400, "invalid_actor", "actor.kind 必须是 character。");
  const card = objectRecord(candidate.card, "actor.card");
  return {
    ...candidate, id, kind: "character", playerControlled: candidate.playerControlled === true,
    background: candidate.background === undefined ? undefined : requiredString(candidate.background, "actor.background", 600),
    card: { ...card, name: requiredString(card.name, "actor.card.name", 120), description: stringField(card.description, "actor.card.description"), personality: stringField(card.personality, "actor.card.personality"), scenario: stringField(card.scenario, "actor.card.scenario"), messageExample: stringField(card.messageExample, "actor.card.messageExample"), instructions: optionalString(card.instructions) },
  } as WorldActorDefinition;
}

export function worldRelations(value: unknown): WorldRelation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) throw new HttpError(400, "invalid_actor", "relations 必须是最多 128 项的数组。");
  return value.map((item, index) => { const relation = objectRecord(item, `relations[${index}]`); return { fromActorId: requiredString(relation.fromActorId, `relations[${index}].fromActorId`, 160), toActorId: requiredString(relation.toActorId, `relations[${index}].toActorId`, 160), description: requiredString(relation.description, `relations[${index}].description`, 1000) }; });
}

export function objectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "invalid_request", `${name} 必须是 object。`);
  return value as Record<string, unknown>;
}

export function objectValue(value: unknown, name: string): Record<string, unknown> { return objectRecord(value, name); }

export function stringField(value: unknown, name: string): string {
  if (typeof value !== "string") throw new HttpError(400, "invalid_actor", `${name} 必须是字符串。`);
  return value;
}

export function requiredString(value: unknown, name: string, maxLength = 200): string {
  const parsed = optionalString(value); if (!parsed) throw new HttpError(400, "invalid_request", `${name} 不能为空。`);
  if (parsed.length > maxLength) throw new HttpError(400, "invalid_request", `${name} 过长。`); return parsed;
}

export function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, "invalid_request", `${name} 必须是有限数字。`); return value;
}

export function optionalString(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }

export function actorStatus(body: Record<string, unknown>): string | null | undefined {
  if (!("status" in body)) return undefined; if (body.status == null) return null;
  if (typeof body.status !== "string") throw new HttpError(400, "invalid_request", "status 必须是字符串或 null。");
  const value = body.status.trim(); if (value.length > 120) throw new HttpError(400, "invalid_request", "status 不能超过 120 个字符。"); return value || null;
}

export function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined; if (typeof value !== "boolean") throw new HttpError(400, "invalid_request", `${name} 必须是 boolean。`); return value;
}

export function optionalSafeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined; if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new HttpError(400, "invalid_request", `${name} 必须是整数。`); return value;
}

export function boundedNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, "invalid_request", `${name} 必须是 ${min} 到 ${max} 之间的数字。`); return value;
}

export function enumString<const TValues extends readonly string[]>(value: unknown, name: string, values: TValues): TValues[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new HttpError(400, "invalid_request", `${name} 必须是 ${values.join("、")} 之一。`);
  return value;
}

function operationRecord(value: unknown, name: string): Record<string, unknown> { return objectRecord(value, name); }
function optionalOperationString(value: unknown, name: string, maxLength = 2_000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw new HttpError(400, "invalid_request", `${name} 必须是长度不超过 ${maxLength} 的字符串。`); return value;
}
function optionalOperationStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new HttpError(400, "invalid_request", `${name} 必须是字符串数组。`); return value as string[];
}
