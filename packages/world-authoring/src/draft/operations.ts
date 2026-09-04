import type {
  WorldDraft,
  WorldDraftBatchReceipt,
  WorldDraftBatchScope,
  WorldDraftOperation,
} from "../types.js";
import { validateWorldDraft } from "../validation.js";

export function batchScope(
  operations: readonly WorldDraftOperation[],
): WorldDraftBatchScope {
  const scopes = new Set(operations.map(operationBatchScope));
  return scopes.size === 1 ? [...scopes][0]! : "mixed";
}

export function createBatchReceipt(input: {
  id: string;
  objective: string;
  scope: WorldDraftBatchScope;
  previous: WorldDraft;
  next: WorldDraft;
  operations: readonly WorldDraftOperation[];
  validationBefore: ReturnType<typeof validateWorldDraft>;
  validation: ReturnType<typeof validateWorldDraft>;
}): WorldDraftBatchReceipt {
  const before = new Set(input.validationBefore.issues.map(validationIssueKey));
  const after = new Set(input.validation.issues.map(validationIssueKey));
  return {
    id: input.id,
    objective: input.objective,
    scope: input.scope,
    previousRevision: input.previous.revision,
    revision: input.next.revision,
    operationTypes: input.operations.map((operation) => operation.type),
    changedSections: changedSections(input.operations),
    validationDelta: {
      resolved: [...before].filter((key) => !after.has(key)),
      introduced: [...after].filter((key) => !before.has(key)),
      remainingErrors: input.validation.issues.filter((issue) => issue.severity === "error").length,
    },
  };
}

function operationBatchScope(operation: WorldDraftOperation): WorldDraftBatchScope {
  switch (operation.type) {
    case "set_metadata":
    case "set_premise":
    case "set_lore":
      return "foundation";
    case "upsert_player":
    case "remove_player":
      return "player";
    case "upsert_actor":
    case "remove_actor":
      return "actors";
    case "upsert_relation":
    case "remove_relation":
      return "relations";
    case "upsert_context":
      return "context";
    case "upsert_chapter":
    case "remove_chapter":
      return "chapters";
    case "set_runtime_profile":
    case "set_sources":
      return "runtime";
  }
}

function validationIssueKey(issue: { code: string; path?: string }): string {
  return issue.path ? `${issue.code}:${issue.path}` : issue.code;
}

function changedSections(operations: readonly WorldDraftOperation[]): string[] {
  return [...new Set(operations.map((operation) => {
    if (operation.type === "set_metadata" || operation.type === "set_premise") return "metadata";
    if (operation.type === "set_lore") return "lore";
    if (operation.type.includes("player")) return "player";
    if (operation.type.includes("actor")) return "actors";
    if (operation.type.includes("relation")) return "relations";
    if (operation.type.includes("context")) return "contexts";
    if (operation.type.includes("chapter")) return "chapters";
    return "runtime";
  }))];
}
