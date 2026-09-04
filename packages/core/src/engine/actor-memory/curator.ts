import type { CharacterCard } from "../../contracts/chat.js";
import type {
  ActorMemoryCandidate,
  ActorMemoryEdgeType,
  ActorMemoryNodeKind,
  ActorMemoryNodeStatus,
  ActorMemoryOperation,
  ActorMemoryPatch,
  ActorMemorySlice,
} from "../../contracts/actor-memory.js";
import type { ChatProvider } from "../../contracts/provider.js";
import type {
  ResolvedWorldActorMemoryPolicy,
  WorldEvent,
} from "../../contracts/world.js";

export interface ActorMemoryCuratorActorInput {
  actorId: string;
  card: CharacterCard;
  events: readonly WorldEvent[];
  recalled: ActorMemorySlice;
  storedNodeCount: number;
  storedActiveNodeCount: number;
  storedNodeStatuses: ReadonlyMap<string, ActorMemoryNodeStatus>;
  memoryIndex: readonly ActorMemoryIndexEntry[];
  anchorEventIds: readonly string[];
  idempotencyKey: string;
}

export interface ActorMemoryIndexEntry {
  id: string;
  kind: ActorMemoryNodeKind;
  semanticKey?: string;
  title: string;
  status: ActorMemoryNodeStatus;
  importance: number;
}

export interface ActorMemoryCuratorInput {
  actors: readonly ActorMemoryCuratorActorInput[];
}

export interface ActorMemoryCuratorTrace {
  type: "prompt" | "response";
  actorIds: string[];
  payload: Record<string, unknown>;
}

const NODE_KINDS = new Set<ActorMemoryNodeKind>([
  "self",
  "belief",
  "preference",
  "commitment",
  "relation",
  "episode",
  "knowledge",
]);
const NODE_STATUSES = new Set<ActorMemoryNodeStatus>([
  "active",
  "superseded",
  "archived",
]);
const EDGE_TYPES = new Set<ActorMemoryEdgeType>([
  "experienced",
  "believes",
  "cares_about",
  "trusts",
  "avoids",
  "causes",
  "contradicts",
  "continues",
]);

/**
 * Converts an Actor's observed event batch into a small, validated memory
 * patch. It never writes storage directly; World commits the patch atomically.
 */
export class ActorMemoryCurator {
  constructor(
    private readonly provider: ChatProvider,
    private readonly policy: ResolvedWorldActorMemoryPolicy,
  ) {}

  async curate(
    input: ActorMemoryCuratorInput,
    signal?: AbortSignal,
    trace?: (event: ActorMemoryCuratorTrace) => void,
  ): Promise<ActorMemoryPatch[]> {
    if (input.actors.length === 0) return [];
    const actorIds = input.actors.map((actor) => actor.actorId);
    const systemPrompt = buildSystemPrompt(this.policy);
    const userPrompt = buildUserPrompt(input);
    trace?.({
      type: "prompt",
      actorIds,
      payload: {
        systemPrompt,
        userPrompt,
        actorIds,
        eventCount: uniqueEvents(input.actors).length,
        recalledNodeIds: Object.fromEntries(input.actors.map((actor) => [
          actor.actorId,
          actor.recalled.entries.map((entry) => entry.node.id),
        ])),
      },
    });
    const requestContext = {
      purpose: "actor_memory" as const,
      actorId: actorIds.length === 1 ? actorIds[0] : undefined,
    };
    const maxTokens = curatorMaxTokens(input.actors.length);
    const response = await this.provider.complete({
      systemPrompt,
      userPrompt,
      maxTokens,
      responseFormat: { type: "json_object" },
      thinking: "enabled",
      requestContext,
      signal,
    });
    trace?.({
      type: "response",
      actorIds,
      payload: { actorIds, response },
    });
    try {
      return parseActorPatches(response, input.actors, this.policy);
    } catch (error) {
      // JSON mode does not guarantee a complete document when the model uses
      // the whole completion budget. A single repair pass is cheaper and more
      // reliable than sending the entire batch into a delayed retry loop.
      const repairedPrompt = buildRepairPrompt(userPrompt, response, error);
      const repairedResponse = await this.provider.complete({
        systemPrompt,
        userPrompt: repairedPrompt,
        maxTokens: Math.min(6_000, maxTokens),
        responseFormat: { type: "json_object" },
        // The first pass already performed semantic reasoning. A repair pass
        // must spend its whole budget on one complete JSON transaction instead
        // of truncating another reasoning-heavy answer.
        thinking: "disabled",
        requestContext,
        signal,
      });
      trace?.({
        type: "response",
        actorIds,
        payload: {
          actorIds,
          response: repairedResponse,
          retry: true,
          parseError: error instanceof Error ? error.message : String(error),
        },
      });
      return parseActorPatches(repairedResponse, input.actors, this.policy);
    }
  }
}

function curatorMaxTokens(actorCount: number): number {
  // Reasoning and the visible JSON share one completion budget on some
  // providers, so leave enough room for a complete multi-Actor transaction.
  return Math.min(8_000, Math.max(4_000, 2_800 + actorCount * 1_200));
}

function buildSystemPrompt(policy: ResolvedWorldActorMemoryPolicy): string {
  return `Actor private long-term memory curator.
你是世界中所有角色共用的长期记忆整理器，但每个角色的记忆必须彼此隔离。

职责边界：
- Timeline 已负责保存“发生过什么”，不要把聊天记录、场景摘要或剧情流水账复制进长期记忆。
- 长期记忆只保存会跨场景影响角色未来判断与行为的主观变化。
- supporting evidence 只是上下文；只有 extraction anchors 指向的变化才值得本轮判断。
- 同一事件对不同角色可形成不同记忆，也可以不形成记忆。角色不可见的事实绝不能写入。

允许保存的类型：
- commitment：尚未完成的承诺、目标、债务或明确决定；完成后必须归档、替换或删除。
- relation：对某个角色的信任、距离、责任或态度发生持久变化。
- preference / belief / self：稳定偏好、信念或自我认知确实发生变化。
- episode：对本人有长期意义的转折经历，而不是普通剧情片段。
- knowledge：该角色亲自获知且以后会影响行动的持久信息。

禁止保存：问候、普通发言、重复信息、临时安排、当前位置、场景气氛、剧情标题、章节进度、调试状态、未经证实的精确事实，以及 Timeline 已足够表达的一次性经历。

整理原则：
- 每个主题最终保存为一份可独立阅读的 Markdown 记忆文档；不要把同一变化拆成多个碎片。
- 这是 consolidation，不是 accumulation。memoryIndex 只用于发现已有主题；只有 recalled memories 提供了完整正文，才可直接 revise/delete。
- 如果新证据命中 memoryIndex 中相同 semanticKey，使用 create 表达新的完整版本，Host 会安全合并到原文档。
- semanticKey 是稳定主题键：relation:<actorId>、commitment:<topic>、preference:<topic>、belief:<topic>、self:<topic>、episode:<topic>、knowledge:<topic>。
- 同一 semanticKey 最多一个 active 节点。关系对同一目标最多一个 active 节点。
- meaningful 历史可 archived/superseded；重复、错误、无长期价值的内容直接 delete。
- 每个角色 active 上限 ${policy.maxNotesPerActor}，cold history 上限 ${policy.maxArchivedNotesPerActor}。满额时先维护旧节点再创建。
- 标题简短，内容不超过 80 个汉字。不得发明证据之外的信息。
- 没有真正长期变化时返回空 actorUpdates；绝不能为了产生结果而写记忆。

只返回一个 JSON 对象：
{
  "actorUpdates": [
    {
      "actorId": "an Actor id from the input",
      "operations": [
        {
          "type": "create",
          "kind": "self|belief|preference|commitment|relation|episode|knowledge",
          "semanticKey": "stable semantic key",
          "title": "short title",
          "content": "durable subjective memory",
          "importance": 0.0,
          "confidence": 0.0,
          "sourceEventIds": ["an event visible to this Actor"],
          "links": [
            {
              "toId": "actor:<id> or another stable identity",
              "type": "experienced|believes|cares_about|trusts|avoids|causes|contradicts|continues",
              "weight": 0.0,
              "description": "optional"
            }
          ]
        },
        {
          "type": "revise",
          "nodeId": "an existing memory id from recalled memories",
          "semanticKey": "optional replacement key",
          "content": "revised content",
          "status": "active|superseded|archived",
          "importance": 0.0,
          "confidence": 0.0,
          "sourceEventIds": ["an event visible to this Actor"]
        },
        {
          "type": "delete",
          "nodeId": "a redundant or obsolete memory id from recalled memories",
          "reason": "short maintenance reason",
          "sourceEventIds": ["an event visible to this Actor"]
        }
      ]
    }
  ]
}

每个角色最多 ${policy.maxOperationsPerUpdate} 个操作，其中 create 最多 ${policy.maxCreatedNotesPerUpdate} 个。不要解释，不要使用 Markdown。`;
}

function buildRepairPrompt(
  originalPrompt: string,
  rawResponse: string,
  error: unknown,
): string {
  return `${originalPrompt}

[Repair the previous response]
The previous response could not be parsed as one complete JSON object.
Error: ${error instanceof Error ? error.message : String(error)}
Previous response prefix:
${truncate(rawResponse, 2_000)}

Return a complete compact JSON object now. Do not explain, do not use Markdown,
do not add new facts, and prefer {"actorUpdates":[]} over an incomplete answer.`;
}

function buildUserPrompt(input: ActorMemoryCuratorInput): string {
  const actors = input.actors.map((actor) => {
    const memories = actor.recalled.entries.length
      ? actor.recalled.entries.map(({ node }) => (
        `  - ${node.id} [${node.kind}/${node.status ?? "active"}] ${node.title}: ${node.content}`
      )).join("\n")
      : "  (none recalled)";
    const memoryIndex = actor.memoryIndex.length
      ? actor.memoryIndex.map((node) => (
        `  - ${node.id} [${node.kind}/${node.status}] key=${node.semanticKey ?? "-"} importance=${node.importance.toFixed(2)} ${node.title}`
      )).join("\n")
      : "  (empty)";
    const anchors = new Set(actor.anchorEventIds);
    const anchorEvents = actor.events.filter((event) => anchors.has(event.id));
    const supportingEvents = actor.events.filter((event) => !anchors.has(event.id));
    return `[Actor]
id=${actor.actorId}
name=${actor.card.name}
storedMemoryNotes=${actor.storedNodeCount}
activeMemoryNotes=${actor.storedActiveNodeCount}
coldMemoryNotes=${actor.storedNodeCount - actor.storedActiveNodeCount}
description=${actor.card.description}
personality=${actor.card.personality}
scenario=${actor.card.scenario}

memoryIndex:
${memoryIndex}

relevantMemoryDetails:
${memories}

extractionAnchors:
${anchorEvents.length ? anchorEvents.map(renderEvent).join("\n") : "  (none)"}

supportingEvidence:
${supportingEvents.length ? supportingEvents.map(renderEvent).join("\n") : "  (none)"}`;
  }).join("\n\n");
  return `[Focus Actors]
${actors}

请分别整理各角色。只允许引用该角色区域中出现的事件 ID。`;
}

function uniqueEvents(
  actors: readonly ActorMemoryCuratorActorInput[],
): WorldEvent[] {
  const events = new Map<string, WorldEvent>();
  for (const actor of actors) {
    for (const event of actor.events) events.set(event.id, event);
  }
  return [...events.values()].sort((a, b) => a.sequence - b.sequence);
}

function renderEvent(event: WorldEvent): string {
  return `- [${event.sequence}] ${event.id} ${event.type}${event.contextId ? ` context=${event.contextId}` : ""}${event.actorId ? ` actor=${event.actorId}` : ""}: ${eventPayloadText(event)}`;
}

function eventPayloadText(event: WorldEvent): string {
  if (event.type === "context.message.committed") {
    return `${event.payload.message.characterName}: ${event.payload.message.message}`;
  }
  if (event.type === "context.action.committed") {
    return `${event.payload.action.characterName}（动作）: ${event.payload.action.action}`;
  }
  if (event.type === "narrative.narration.committed") {
    return event.payload.narration.text;
  }
  if (event.type === "world.event.emitted") {
    return event.payload.message;
  }
  return truncate(JSON.stringify(event.payload), 1_000);
}

function parseOperations(
  values: unknown[],
  allowedSourceIds: ReadonlySet<string>,
  memoryIndex: readonly ActorMemoryIndexEntry[],
  recalledNodeIds: ReadonlySet<string>,
  policy: ResolvedWorldActorMemoryPolicy,
  storedNodeStatuses: ReadonlyMap<string, ActorMemoryNodeStatus>,
): ActorMemoryOperation[] {
  const operations: ActorMemoryOperation[] = [];
  let creates = 0;
  const mutableNodeIds = recalledNodeIds;
  const activeBySemanticKey = new Map(
    memoryIndex
      .filter((entry) => entry.status === "active" && entry.semanticKey)
      .map((entry) => [entry.semanticKey!, entry]),
  );

  for (const value of values) {
    if (operations.length >= policy.maxOperationsPerUpdate) break;
    const object = asObject(value);
    if (!object) continue;
    if (object.type === "create") {
      if (creates >= policy.maxCreatedNotesPerUpdate) continue;
      const candidate = parseCandidate(object, allowedSourceIds);
      if (!candidate) continue;
      const semanticKey = candidate.semanticKey!;
      const existing = activeBySemanticKey.get(semanticKey);
      if (existing) {
        if (existing.id.startsWith("pending:")) continue;
        operations.push({
          type: "revise",
          revision: {
            nodeId: existing.id,
            semanticKey,
            title: candidate.title,
            content: candidate.content,
            status: "active",
            importance: candidate.importance,
            confidence: candidate.confidence,
            tags: candidate.tags,
            sourceEventIds: candidate.sourceEventIds,
          },
        });
      } else {
        operations.push({ type: "create", candidate });
        creates++;
        activeBySemanticKey.set(semanticKey, {
          id: `pending:${semanticKey}`,
          kind: candidate.kind,
          semanticKey,
          title: candidate.title,
          status: "active",
          importance: candidate.importance ?? 0.5,
        });
      }
    } else if (object.type === "revise") {
      const nodeId = readText(object.nodeId);
      if (!nodeId || !mutableNodeIds.has(nodeId)) continue;
      const sourceEventIds = readSourceIds(object.sourceEventIds, allowedSourceIds);
      if (sourceEventIds.length === 0) continue;
      const status = typeof object.status === "string" && NODE_STATUSES.has(object.status as ActorMemoryNodeStatus)
        ? object.status as ActorMemoryNodeStatus
        : undefined;
      const title = readText(object.title);
      const content = readText(object.content);
      if (!title && !content && !status && object.importance === undefined && object.confidence === undefined) {
        continue;
      }
      operations.push({
        type: "revise",
        revision: {
          nodeId,
          semanticKey: readText(object.semanticKey),
          title,
          content,
          status,
          importance: readWeight(object.importance),
          confidence: readWeight(object.confidence),
          tags: readTextArray(object.tags),
          sourceEventIds,
        },
      });
    } else if (object.type === "delete") {
      const nodeId = readText(object.nodeId);
      if (!nodeId || !mutableNodeIds.has(nodeId)) continue;
      const sourceEventIds = readSourceIds(object.sourceEventIds, allowedSourceIds);
      if (sourceEventIds.length === 0) continue;
      operations.push({
        type: "delete",
        deletion: {
          nodeId,
          sourceEventIds,
          reason: readText(object.reason),
        },
      });
    }
  }
  return enforceMemoryBudgets(operations, storedNodeStatuses, policy);
}

function parseActorPatches(
  raw: string,
  actors: readonly ActorMemoryCuratorActorInput[],
  policy: ResolvedWorldActorMemoryPolicy,
): ActorMemoryPatch[] {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.actorUpdates)) {
    throw new Error("Actor memory curator response requires actorUpdates.");
  }
  const updates = parsed.actorUpdates;
  const updatesByActor = new Map<string, unknown[]>();
  for (const value of updates) {
    const update = asObject(value);
    const actorId = update ? readText(update.actorId) : undefined;
    if (!actorId || updatesByActor.has(actorId)) continue;
    updatesByActor.set(
      actorId,
      Array.isArray(update?.operations) ? update.operations : [],
    );
  }

  return actors.map((actor) => {
    const sourceEventIds = actor.events.map((event) => event.id);
    return {
      idempotencyKey: actor.idempotencyKey,
      sourceEventIds,
      operations: parseOperations(
        updatesByActor.get(actor.actorId) ?? [],
        new Set(sourceEventIds),
        actor.memoryIndex,
        new Set(actor.recalled.entries.map((entry) => entry.node.id)),
        policy,
        actor.storedNodeStatuses,
      ),
    };
  });
}

function enforceMemoryBudgets(
  operations: readonly ActorMemoryOperation[],
  initialStatuses: ReadonlyMap<string, ActorMemoryNodeStatus>,
  policy: ResolvedWorldActorMemoryPolicy,
): ActorMemoryOperation[] {
  const statuses = new Map(initialStatuses);
  let activeCount = [...statuses.values()].filter((status) => status === "active").length;
  let coldCount = statuses.size - activeCount;
  const accepted: ActorMemoryOperation[] = [];

  const maintenanceFirst = [
    ...operations.filter((operation) => operation.type !== "create"),
    ...operations.filter((operation) => operation.type === "create"),
  ];
  for (const operation of maintenanceFirst) {
    let nextActive = activeCount;
    let nextCold = coldCount;
    if (operation.type === "create") {
      nextActive++;
    } else if (operation.type === "revise") {
      const previous = statuses.get(operation.revision.nodeId);
      const next = operation.revision.status ?? previous;
      if (!previous || !next) continue;
      if (previous === "active" && next !== "active") {
        nextActive--;
        nextCold++;
      } else if (previous !== "active" && next === "active") {
        nextActive++;
        nextCold--;
      }
    } else if (operation.type === "delete") {
      const previous = statuses.get(operation.deletion.nodeId);
      if (!previous) continue;
      if (previous === "active") nextActive--;
      else nextCold--;
    }

    if (
      (nextActive > policy.maxNotesPerActor && nextActive > activeCount) ||
      (nextCold > policy.maxArchivedNotesPerActor && nextCold > coldCount)
    ) continue;

    accepted.push(operation);
    activeCount = nextActive;
    coldCount = nextCold;
    if (operation.type === "revise" && operation.revision.status) {
      statuses.set(operation.revision.nodeId, operation.revision.status);
    } else if (operation.type === "delete") {
      statuses.delete(operation.deletion.nodeId);
    }
  }
  return accepted;
}

function parseCandidate(
  object: Record<string, unknown>,
  allowedSourceIds: ReadonlySet<string>,
): ActorMemoryCandidate | undefined {
  if (typeof object.kind !== "string" || !NODE_KINDS.has(object.kind as ActorMemoryNodeKind)) {
    return undefined;
  }
  const title = readText(object.title);
  const content = readText(object.content);
  const semanticKey = readText(object.semanticKey);
  const sourceEventIds = readSourceIds(object.sourceEventIds, allowedSourceIds);
  if (!title || !content || !semanticKey || sourceEventIds.length === 0) return undefined;
  const links = Array.isArray(object.links)
    ? object.links.flatMap((value) => {
      const link = asObject(value);
      const toId = link ? readText(link.toId) : undefined;
      if (
        !link ||
        !toId ||
        typeof link.type !== "string" ||
        !EDGE_TYPES.has(link.type as ActorMemoryEdgeType)
      ) return [];
      return [{
        toId,
        type: link.type as ActorMemoryEdgeType,
        weight: readWeight(link.weight),
        description: readText(link.description),
      }];
    })
    : undefined;
  return {
    kind: object.kind as ActorMemoryNodeKind,
    semanticKey,
    title,
    content,
    importance: readWeight(object.importance),
    confidence: readWeight(object.confidence),
    tags: readTextArray(object.tags),
    sourceEventIds,
    links,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const normalized = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const value = JSON.parse(normalized) as unknown;
  const object = asObject(value);
  if (!object) throw new Error("Actor memory curator returned a non-object response.");
  return object;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function readTextArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = [...new Set(value.map(readText).filter((item): item is string => Boolean(item)))];
  return values.length ? values : undefined;
}

function readSourceIds(
  value: unknown,
  allowedSourceIds: ReadonlySet<string>,
): string[] {
  return (readTextArray(value) ?? []).filter((id) => allowedSourceIds.has(id));
}

function readWeight(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
