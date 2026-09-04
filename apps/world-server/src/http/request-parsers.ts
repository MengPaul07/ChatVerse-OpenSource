import type { IncomingMessage } from "node:http";
import type {
  ProviderModelProfile,
  ProviderProtocol,
  WebResearchProtocol,
  WorldActorDefinition,
  WorldRelation,
} from "@chatverse/core";
import { isProviderProtocol, isWebResearchProtocol } from "@chatverse/core";
import type { WorldDraftOperation } from "@chatverse/world-authoring";
import { HttpError } from "./errors.js";
import {
  PROVIDER_BASE_URL_HEADER,
  PROVIDER_KEY_HEADER,
  PROVIDER_MODEL_HEADER,
  PROVIDER_NAME_HEADER,
  PROVIDER_OPTIONS_HEADER,
  PROVIDER_MODEL_PROFILE_HEADER,
  PROVIDER_PROTOCOL_HEADER,
  PROVIDER_RESEARCH_MODEL_HEADER,
  RESEARCH_PROVIDER_BASE_URL_HEADER,
  RESEARCH_PROVIDER_KEY_HEADER,
  RESEARCH_PROVIDER_NAME_HEADER,
  RESEARCH_PROVIDER_OPTIONS_HEADER,
  RESEARCH_PROVIDER_PROTOCOL_HEADER,
  type ProviderRequestConfig,
} from "../provider-config.js";
import { readJson as readRequestJson } from "./validation.js";

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_SOURCE_BUNDLES = 8;
const MAX_PROVIDER_OPTIONS_BYTES = 8 * 1024;
const MAX_PROVIDER_MODEL_PROFILE_BYTES = 24 * 1024;
const UTF8_HEADER_PREFIX = "chatverse-utf8:";

export function optionalImageReference(body: Record<string, unknown>): {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
} | undefined {
  if (body.referenceImageBase64 === undefined) return undefined;
  const encoded = requiredString(body.referenceImageBase64, "referenceImageBase64", 14 * 1024 * 1024);
  const mimeType = enumString(
    body.referenceMimeType,
    "referenceMimeType",
    ["image/png", "image/jpeg", "image/webp"] as const,
  );
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
    throw new HttpError(400, "invalid_reference_image", "参考图片需要是不超过 10MB 的 PNG、JPEG 或 WebP。 ");
  }
  return { bytes, mimeType };
}

export function providerConfigFromRequest(request: IncomingMessage): ProviderRequestConfig | undefined {
  const apiKey = readOptionalHeader(request, PROVIDER_KEY_HEADER);
  const baseURL = readOptionalHeader(request, PROVIDER_BASE_URL_HEADER);
  const model = readOptionalHeader(request, PROVIDER_MODEL_HEADER);
  const researchModel = readOptionalHeader(request, PROVIDER_RESEARCH_MODEL_HEADER);
  const researchApiKey = readOptionalHeader(request, RESEARCH_PROVIDER_KEY_HEADER);
  const researchBaseURL = readOptionalHeader(request, RESEARCH_PROVIDER_BASE_URL_HEADER);
  const researchProtocolValue = readOptionalHeader(request, RESEARCH_PROVIDER_PROTOCOL_HEADER);
  const researchProviderName = readOptionalUtf8Header(request, RESEARCH_PROVIDER_NAME_HEADER);
  const researchOptionsValue = readOptionalUtf8Header(request, RESEARCH_PROVIDER_OPTIONS_HEADER);
  const protocolValue = readOptionalHeader(request, PROVIDER_PROTOCOL_HEADER);
  const providerName = readOptionalUtf8Header(request, PROVIDER_NAME_HEADER);
  const optionsValue = readOptionalUtf8Header(request, PROVIDER_OPTIONS_HEADER);
  const modelProfileValue = readOptionalUtf8Header(request, PROVIDER_MODEL_PROFILE_HEADER);
  if (!apiKey && !baseURL && !model && !protocolValue && !providerName && !optionsValue && !modelProfileValue
    && !researchApiKey && !researchBaseURL && !researchModel && !researchProtocolValue
    && !researchProviderName && !researchOptionsValue) {
    return undefined;
  }
  validateProviderBaseURL(baseURL, "API Base URL");
  validateProviderBaseURL(researchBaseURL, "联网 API Base URL");
  const protocol = protocolValue
    ? parseProviderProtocol(protocolValue)
    : undefined;
  const providerOptions = optionsValue
    ? parseProviderOptions(optionsValue)
    : undefined;
  const modelProfile = modelProfileValue
    ? parseProviderModelProfile(modelProfileValue)
    : undefined;
  const researchProtocol = researchProtocolValue
    ? parseWebResearchProtocol(researchProtocolValue)
    : undefined;
  if ((researchApiKey || researchBaseURL || researchModel || researchProviderName || researchOptionsValue) && !researchProtocol) {
    throw new HttpError(400, "invalid_provider_config", "联网配置缺少联网协议。 ");
  }
  const researchOptions = researchOptionsValue
    ? parseProviderOptions(researchOptionsValue)
    : undefined;
  return {
    apiKey,
    baseURL,
    model,
    protocol,
    providerName,
    providerOptions,
    modelProfile,
    ...(researchProtocol ? {
      research: {
        protocol: researchProtocol,
        apiKey: researchApiKey,
        baseURL: researchBaseURL,
        model: researchModel,
        providerName: researchProviderName,
        options: researchOptions,
      },
    } : {}),
  };
}

function validateProviderBaseURL(value: string | undefined, label: string): void {
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "invalid_provider_config", `${label} 不是有效地址。请输入 http 或 https 地址。`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new HttpError(400, "invalid_provider_config", `${label} 只支持 http 或 https 地址，且不能包含账号密码。`);
  }
}

function parseProviderProtocol(value: string): ProviderProtocol {
  if (isProviderProtocol(value)) return value;
  throw new HttpError(400, "invalid_provider_config", "协议必须是 openai-chat、openai-responses 或 anthropic-messages。 ");
}

function parseWebResearchProtocol(value: string): WebResearchProtocol {
  if (isWebResearchProtocol(value)) return value;
  throw new HttpError(400, "invalid_provider_config", "联网协议必须是 responses-web-search、tavily-search 或 zhipu-web-search。 ");
}

function parseProviderOptions(value: string): Record<string, unknown> {
  if (Buffer.byteLength(value, "utf8") > MAX_PROVIDER_OPTIONS_BYTES) {
    throw new HttpError(400, "invalid_provider_config", "Provider options 过大。 ");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "invalid_provider_config", "Provider options 必须是有效 JSON 对象。 ");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_provider_config", "Provider options 必须是 JSON 对象。 ");
  }
  if (containsCredentialField(parsed)) {
    throw new HttpError(400, "invalid_provider_config", "Provider options 不能包含 Key、Token 或授权字段。 ");
  }
  return parsed as Record<string, unknown>;
}

function parseProviderModelProfile(value: string): ProviderModelProfile {
  if (Buffer.byteLength(value, "utf8") > MAX_PROVIDER_MODEL_PROFILE_BYTES) {
    throw new HttpError(400, "invalid_provider_config", "Model profile 过大。 ");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "invalid_provider_config", "Model profile 必须是有效 JSON 对象。 ");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_provider_config", "Model profile 必须是 JSON 对象。 ");
  }
  if (containsCredentialField(parsed)) {
    throw new HttpError(400, "invalid_provider_config", "Model profile 不能包含 Key、Token 或授权字段。 ");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new HttpError(400, "invalid_provider_config", "Model profile 缺少模型 ID。 ");
  }
  if (typeof record.reasoning !== "boolean") {
    throw new HttpError(400, "invalid_provider_config", "Model profile 的 reasoning 必须是布尔值。 ");
  }
  if (!Array.isArray(record.input) || record.input.some((item) => item !== "text" && item !== "image")) {
    throw new HttpError(400, "invalid_provider_config", "Model profile 的 input 只能包含 text 或 image。 ");
  }
  return parsed as ProviderModelProfile;
}

function containsCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.replace(/[-_]/g, "").toLowerCase();
    return ["apikey", "authorization", "secret", "password", "accesstoken", "refreshtoken"].includes(normalized)
      || containsCredentialField(nested);
  });
}

function readOptionalHeader(request: IncomingMessage, name: string): string | undefined {
  const raw = request.headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value || undefined;
}

function readOptionalUtf8Header(request: IncomingMessage, name: string): string | undefined {
  const value = readOptionalHeader(request, name);
  if (!value || !value.startsWith(UTF8_HEADER_PREFIX)) return value;
  try {
    return decodeURIComponent(value.slice(UTF8_HEADER_PREFIX.length));
  } catch {
    throw new HttpError(400, "invalid_provider_config", "Provider 配置包含无效的 UTF-8 Header。 ");
  }
}

export async function readJson(
  request: IncomingMessage,
  maxBytes = MAX_REQUEST_BYTES,
): Promise<Record<string, unknown>> {
  return readRequestJson(request, maxBytes);
}

export function draftOperations(value: unknown): WorldDraftOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new HttpError(400, "invalid_request", "operations 必须是 1 到 12 项的数组。");
  }
  return value.map((value, index) => {
    const operation = operationRecord(value, `operations[${index}]`);
    const type = requiredString(operation.type, `operations[${index}].type`, 40) as WorldDraftOperation["type"];
    switch (type) {
      case "set_metadata":
        return {
          type,
          metadata: operationRecord(operation.metadata, `${type}.metadata`),
        } as WorldDraftOperation;
      case "set_premise":
        return { type, premise: requiredString(operation.premise, `${type}.premise`, 20_000) };
      case "set_lore":
        return {
          type,
          lore: operationRecord(operation.lore, `${type}.lore`),
        } as WorldDraftOperation;
      case "upsert_player": {
        const player = operationRecord(operation.player, `${type}.player`);
        optionalOperationString(player.id, `${type}.player.id`);
        return { type, player } as WorldDraftOperation;
      }
      case "remove_player":
        return { type };
      case "upsert_actor": {
        const actor = operationRecord(operation.actor, `${type}.actor`);
        optionalOperationString(actor.id, `${type}.actor.id`);
        if (actor.role !== undefined && actor.role !== "lead" && actor.role !== "support") {
          throw new HttpError(400, "invalid_request", `${type}.actor.role 不合法。`);
        }
        optionalOperationString(actor.background, `${type}.actor.background`, 20_000);
        const card = operationRecord(actor.card, `${type}.actor.card`);
        return { type, actor: { ...actor, card } } as unknown as WorldDraftOperation;
      }
      case "remove_actor":
        return { type, actorId: requiredString(operation.actorId, `${type}.actorId`, 160) };
      case "upsert_relation": {
        const relation = operationRecord(operation.relation, `${type}.relation`);
        optionalOperationString(relation.id, `${type}.relation.id`);
        return {
          type,
          relation: {
            ...relation,
            fromActorId: requiredString(relation.fromActorId, `${type}.relation.fromActorId`, 160),
            toActorId: requiredString(relation.toActorId, `${type}.relation.toActorId`, 160),
            description: requiredString(relation.description, `${type}.relation.description`, 2_000),
          },
        } as unknown as WorldDraftOperation;
      }
      case "remove_relation":
        return { type, relationId: requiredString(operation.relationId, `${type}.relationId`, 160) };
      case "upsert_context": {
        const context = operationRecord(operation.context, `${type}.context`);
        optionalOperationString(context.id, `${type}.context.id`);
        const actorIds = optionalOperationStringArray(context.actorIds, `${type}.context.actorIds`);
        const scene = operationRecord(context.scene, `${type}.context.scene`);
        return {
          type,
          context: {
            ...context,
            ...(actorIds ? { actorIds } : {}),
            name: requiredString(context.name, `${type}.context.name`, 160),
            scene,
            opening: draftOperationText(context.opening, `${type}.context.opening`, 20_000),
          },
        } as unknown as WorldDraftOperation;
      }
      case "upsert_chapter": {
        const chapter = operationRecord(operation.chapter, `${type}.chapter`);
        optionalOperationString(chapter.id, `${type}.chapter.id`);
        const actorIds = optionalOperationStringArray(chapter.actorIds, `${type}.chapter.actorIds`);
        const contextIds = optionalOperationStringArray(chapter.contextIds, `${type}.chapter.contextIds`);
        return {
          type,
          chapter: {
            ...chapter,
            ...(actorIds ? { actorIds } : {}),
            ...(contextIds ? { contextIds } : {}),
            title: requiredString(chapter.title, `${type}.chapter.title`, 240),
            treatment: requiredString(chapter.treatment, `${type}.chapter.treatment`, 30_000),
            targetOutcome: requiredString(chapter.targetOutcome, `${type}.chapter.targetOutcome`, 4_000),
          },
        } as WorldDraftOperation;
      }
      case "remove_chapter":
        return { type, chapterId: requiredString(operation.chapterId, `${type}.chapterId`, 160) };
      case "set_sources": {
        if (!Array.isArray(operation.sources) || operation.sources.length > MAX_SOURCE_BUNDLES) {
          throw new HttpError(
            400,
            "invalid_request",
            `set_sources.sources 必须是不超过 ${MAX_SOURCE_BUNDLES} 项的数组。`,
          );
        }
        const seen = new Set<string>();
        const sources = operation.sources.map((candidate, index) => {
          const binding = operationRecord(candidate, `${type}.sources[${index}]`);
          const bundleId = requiredString(binding.bundleId, `${type}.sources[${index}].bundleId`, 200);
          const revision = requiredNumber(binding.revision, `${type}.sources[${index}].revision`);
          if (!Number.isSafeInteger(revision) || revision < 1) {
            throw new HttpError(400, "invalid_request", `${type}.sources[${index}].revision 必须是正整数。`);
          }
          const fidelity = enumString(
            binding.fidelity,
            `${type}.sources[${index}].fidelity`,
            ["strict", "reference", "free"] as const,
          );
          const key = `${bundleId}@${revision}`;
          if (seen.has(key)) {
            throw new HttpError(400, "invalid_request", `资料源绑定重复：${key}。`);
          }
          seen.add(key);
          return { bundleId, revision, fidelity };
        });
        return { type, sources };
      }
      case "set_runtime_profile":
        return {
          type,
          runtimeProfile: enumString(
            operation.runtimeProfile,
            `${type}.runtimeProfile`,
            ["world_story", "group_chat"] as const,
          ),
        };
      default:
        throw new HttpError(400, "invalid_request", `不支持的草稿操作：${type}。`);
    }
  });
}

function operationRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", `${name} 必须是 object。`);
  }
  return value as Record<string, unknown>;
}

function optionalOperationString(
  value: unknown,
  name: string,
  maxLength = 2_000,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, "invalid_request", `${name} 必须是长度不超过 ${maxLength} 的字符串。`);
  }
  return value;
}

function draftOperationText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, "invalid_request", `${name} 必须是长度不超过 ${maxLength} 的字符串。`);
  }
  return value.trim();
}

function optionalOperationStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "invalid_request", `${name} 必须是字符串数组。`);
  }
  return value as string[];
}

export function worldActorDefinition(value: unknown): WorldActorDefinition {
  const candidate = objectRecord(value, "actor");
  const id = requiredString(candidate.id, "actor.id", 160);
  if (candidate.kind === "character") {
    const card = objectRecord(candidate.card, "actor.card");
    return {
      ...candidate,
      id,
      kind: "character",
      playerControlled: candidate.playerControlled === true,
      background: candidate.background === undefined
        ? undefined
        : requiredString(candidate.background, "actor.background", 600),
      card: {
        ...card,
        name: requiredString(card.name, "actor.card.name", 120),
        description: stringField(card.description, "actor.card.description"),
        personality: stringField(card.personality, "actor.card.personality"),
        scenario: stringField(card.scenario, "actor.card.scenario"),
        messageExample: stringField(card.messageExample, "actor.card.messageExample"),
        instructions: optionalString(card.instructions),
      },
    } as WorldActorDefinition;
  }
  throw new HttpError(400, "invalid_actor", "actor.kind 必须是 character。");
}

export function worldRelations(value: unknown): WorldRelation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) {
    throw new HttpError(400, "invalid_actor", "relations 必须是最多 128 项的数组。");
  }
  return value.map((item, index) => {
    const relation = objectRecord(item, `relations[${index}]`);
    return {
      fromActorId: requiredString(
        relation.fromActorId,
        `relations[${index}].fromActorId`,
        160,
      ),
      toActorId: requiredString(
        relation.toActorId,
        `relations[${index}].toActorId`,
        160,
      ),
      description: requiredString(
        relation.description,
        `relations[${index}].description`,
        1000,
      ),
    };
  });
}

function objectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_actor", `${name} 必须是 object。`);
  }
  return value as Record<string, unknown>;
}

export function objectValue(value: unknown, name: string): Record<string, unknown> {
  return objectRecord(value, name);
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_actor", `${name} 必须是字符串。`);
  }
  return value;
}

export function requiredString(
  value: unknown,
  name: string,
  maxLength = 200,
): string {
  const parsed = optionalString(value);
  if (!parsed) throw new HttpError(400, "invalid_request", `${name} 不能为空。`);
  if (parsed.length > maxLength) {
    throw new HttpError(400, "invalid_request", `${name} 过长。`);
  }
  return parsed;
}

export function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "invalid_request", `${name} 必须是有限数字。`);
  }
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function actorStatus(body: Record<string, unknown>): string | null | undefined {
  if (!("status" in body)) return undefined;
  if (body.status == null) return null;
  if (typeof body.status !== "string") {
    throw new HttpError(400, "invalid_request", "status 必须是字符串或 null。");
  }
  const value = body.status.trim();
  if (value.length > 120) {
    throw new HttpError(400, "invalid_request", "status 不能超过 120 个字符。");
  }
  return value || null;
}

export function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new HttpError(400, "invalid_request", `${name} 必须是 boolean。`);
  }
  return value;
}

export function optionalSafeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new HttpError(400, "invalid_request", `${name} 必须是整数。`);
  }
  return value;
}

export function boundedNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, "invalid_request", `${name} 必须是 ${min} 到 ${max} 之间的数字。`);
  }
  return value;
}

export function enumString<const TValues extends readonly string[]>(
  value: unknown,
  name: string,
  values: TValues,
): TValues[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new HttpError(
      400,
      "invalid_request",
      `${name} 必须是 ${values.join("、")} 之一。`,
    );
  }
  return value;
}
