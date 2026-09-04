import type { ToolCall } from "@chatverse/core";
import type { DraftIdGenerator } from "../../draft.js";
import type {
  WorldAuthoringPlan,
  WorldAuthoringPlanItem,
  WorldAuthoringScope,
  WorldDraftOperation,
} from "../../types.js";

const DRAFT_MUTATION_TOOLS = new Set([
  "update_world_core",
  "save_player_card",
  "save_actor",
  "save_relations",
  "save_context",
  "save_chapter",
  "remove_draft_entities",
  "set_runtime_profile",
]);

export class AuthoringToolInputError extends Error {
  constructor(
    readonly type: "invalid_tool_arguments",
    message: string,
  ) {
    super(message);
    this.name = "AuthoringToolInputError";
  }
}

export function isDraftMutationTool(name: string): boolean {
  return DRAFT_MUTATION_TOOLS.has(name);
}

export function parseArgs(call: ToolCall): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(call.function.arguments) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthoringToolInputError(
      "invalid_tool_arguments",
      `工具参数不是完整 JSON：${detail}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthoringToolInputError("invalid_tool_arguments", "工具参数必须是对象。");
  }
  return value as Record<string, unknown>;
}

export function parseOperations(value: unknown): WorldDraftOperation[] {
  if (!Array.isArray(value)) throw new Error("operations 必须是数组。");
  if (value.length === 0) throw new Error("operations 至少需要一个修改。");
  const allowed = new Set([
    "set_metadata",
    "set_premise",
    "set_lore",
    "upsert_player",
    "remove_player",
    "upsert_actor",
    "remove_actor",
    "upsert_relation",
    "remove_relation",
    "upsert_context",
    "upsert_chapter",
    "remove_chapter",
    "set_runtime_profile",
  ]);
  for (const [index, operation] of value.entries()) {
    if (
      !operation
      || typeof operation !== "object"
      || Array.isArray(operation)
      || !allowed.has(String((operation as { type?: unknown }).type))
    ) {
      throw new Error(`operations[${index}] 不是支持的草稿操作。`);
    }
    const record = operation as Record<string, unknown>;
    const path = `operations[${index}]`;
    switch (record.type) {
      case "set_metadata":
        requiredRecord(record.metadata, `${path}.metadata`);
        break;
      case "set_premise":
        if (typeof record.premise !== "string") {
          record.premise = requiredString(
            requiredRecord(record.premise, `${path}.premise`).text,
            `${path}.premise.text`,
          );
        } else {
          requiredString(record.premise, `${path}.premise`);
        }
        break;
      case "set_lore":
        requiredRecord(record.lore, `${path}.lore`);
        break;
      case "upsert_player":
        optionalString(requiredRecord(record.player, `${path}.player`).id, `${path}.player.id`);
        break;
      case "upsert_actor": {
        const actor = requiredRecord(record.actor, `${path}.actor`);
        optionalString(actor.id, `${path}.actor.id`);
        requiredRecord(actor.card, `${path}.actor.card`);
        break;
      }
      case "remove_actor":
        requiredString(record.actorId, `${path}.actorId`);
        break;
      case "upsert_relation": {
        const relation = requiredRecord(record.relation, `${path}.relation`);
        optionalString(relation.id, `${path}.relation.id`);
        break;
      }
      case "remove_relation":
        requiredString(record.relationId, `${path}.relationId`);
        break;
      case "upsert_context": {
        const context = requiredRecord(record.context, `${path}.context`);
        optionalString(context.id, `${path}.context.id`);
        requiredRecord(context.scene, `${path}.context.scene`);
        break;
      }
      case "upsert_chapter": {
        const chapter = requiredRecord(record.chapter, `${path}.chapter`);
        optionalString(chapter.id, `${path}.chapter.id`);
        break;
      }
      case "remove_chapter":
        requiredString(record.chapterId, `${path}.chapterId`);
        break;
      case "set_runtime_profile":
        requiredString(record.runtimeProfile, `${path}.runtimeProfile`);
        break;
      case "remove_player":
        break;
    }
  }
  return structuredClone(value) as WorldDraftOperation[];
}

export function parseAuthoringPlan(
  args: Record<string, unknown>,
  nextId: DraftIdGenerator,
): WorldAuthoringPlan {
  const goal = requiredString(args.goal, "goal");
  if (!Array.isArray(args.items) || args.items.length < 2 || args.items.length > 6) {
    throw new Error("items 必须包含 2-6 个创作阶段。");
  }
  const allowedScopes = new Set<WorldAuthoringScope>([
    "foundation",
    "actors",
    "relations",
    "context",
    "chapters",
    "polish",
  ]);
  const items = args.items.map((value, index): WorldAuthoringPlanItem => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`items[${index}] 必须是对象。`);
    }
    const item = value as Record<string, unknown>;
    const scope = requiredString(item.scope, `items[${index}].scope`) as WorldAuthoringScope;
    if (!allowedScopes.has(scope)) {
      throw new Error(`items[${index}].scope 不受支持。`);
    }
    return {
      id: nextId("plan-item"),
      title: requiredString(item.title, `items[${index}].title`),
      scope,
      status: index === 0 ? "in_progress" : "pending",
    };
  });
  return { id: nextId("plan"), goal, items };
}

export function activePlanItem(
  plan: WorldAuthoringPlan | undefined,
): WorldAuthoringPlanItem | undefined {
  return plan?.items.find((item) => (
    item.status === "in_progress" || item.status === "awaiting_review"
  ));
}

export function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} 必须是非空字符串。`);
  }
  return value.trim();
}

export function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} 必须是整数。`);
  }
  return value;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function createDefaultIdGenerator(): DraftIdGenerator {
  let sequence = 0;
  return (prefix) => `${prefix}:${Date.now().toString(36)}:${++sequence}`;
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${field} 必须是字符串。`);
  }
}
