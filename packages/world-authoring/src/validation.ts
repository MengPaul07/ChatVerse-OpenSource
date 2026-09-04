import type {
  DraftValidationIssue,
  DraftValidationResult,
  WorldDraft,
} from "./types.js";

export function validateWorldDraft(draft: WorldDraft): DraftValidationResult {
  const issues: DraftValidationIssue[] = [];
  const actorIds = new Set<string>();
  const contextIds = new Set<string>();
  const relationIds = new Set<string>();
  const chapterIds = new Set<string>();
  const sourceIds = new Set<string>();

  required(issues, draft.id, "draft.id", "missing_draft_id", "世界草稿缺少 ID。");
  required(issues, draft.metadata.name, "metadata.name", "missing_name", "请填写世界名称。");
  required(issues, draft.metadata.description, "metadata.description", "missing_description", "请填写世界简介。");
  required(issues, draft.premise, "premise", "missing_premise", "请填写世界前提。");
  if (!textValue(draft.lore?.core)) {
    warning(issues, "lore.core", "missing_lore_core", "核心背景为空，Director 很难保持世界一致。");
  }
  if (draft.contexts.length !== 1) {
    error(issues, "contexts", "context_count", "第一版只能包含一个 Context。");
  }
  if (draft.actors.length === 0) {
    error(issues, "actors", "missing_actor", "至少需要一个 AI Actor。");
  }

  for (const [index, source] of (draft.sources ?? []).entries()) {
    const path = `sources.${index}`;
    const bundleId = textValue(source.bundleId);
    if (!bundleId) {
      error(issues, `${path}.bundleId`, "missing_source_bundle_id", "资料源缺少 bundleId。");
    } else if (sourceIds.has(bundleId)) {
      error(issues, `${path}.bundleId`, "source_binding_duplicate", `资料源重复绑定：${bundleId}`);
    } else {
      sourceIds.add(bundleId);
    }
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) {
      error(issues, `${path}.revision`, "invalid_source_revision", "资料源 revision 必须是正整数。");
    }
    if (!["strict", "reference", "free"].includes(source.fidelity)) {
      error(issues, `${path}.fidelity`, "invalid_source_fidelity", "资料源遵循方式不合法。");
    }
  }

  if (draft.player) {
    addUniqueId(issues, actorIds, draft.player.id, "player.id", "actor_id_duplicate");
    required(issues, draft.player.profile?.name, "player.profile.name", "missing_player_name", "玩家角色缺少名称。");
  }

  for (const [index, actor] of draft.actors.entries()) {
    const path = `actors.${index}`;
    const card = actor.card ?? {};
    addUniqueId(issues, actorIds, actor.id, `${path}.id`, "actor_id_duplicate");
    required(issues, card.name, `${path}.card.name`, "missing_actor_name", "角色缺少名称。");
    required(issues, card.description, `${path}.card.description`, "missing_actor_description", `${textValue(card.name) || "角色"}缺少身份描述。`);
    required(issues, card.personality, `${path}.card.personality`, "missing_actor_personality", `${textValue(card.name) || "角色"}缺少性格与说话方式。`);
    required(issues, card.scenario, `${path}.card.scenario`, "missing_actor_scenario", `${textValue(card.name) || "角色"}缺少自身世界背景。`);
    if (!textValue(card.messageExample)) {
      warning(issues, `${path}.card.messageExample`, "missing_message_example", `${textValue(card.name) || "角色"}缺少语言示例。`);
    }
  }

  const duplicateNames = duplicates([
    ...draft.actors.map((actor) => textValue(actor.card?.name)),
    ...(draft.player ? [textValue(draft.player.profile?.name)] : []),
  ].filter(Boolean));
  for (const name of duplicateNames) {
    error(issues, "actors", "actor_name_duplicate", `同一 Context 内存在重名 Actor：${name}`);
  }

  for (const [index, context] of draft.contexts.entries()) {
    const path = `contexts.${index}`;
    addUniqueId(issues, contextIds, context.id, `${path}.id`, "context_id_duplicate");
    required(issues, context.name, `${path}.name`, "missing_context_name", "Context 缺少名称。");
    required(issues, context.opening, `${path}.opening`, "missing_opening", "请填写可观察的开场场景。");
    required(issues, context.scene?.topic, `${path}.scene.topic`, "missing_scene_topic", "开场缺少当前主题。");
    if (draft.runtimeProfile === "world_story" && !draft.player) {
      error(issues, "player", "missing_world_player", "叙事世界必须先建立玩家角色卡，才能进入世界或演出。");
    }
    if (context.presentation?.kind === "galgame") {
      if (!draft.player || context.presentation.playerActorId !== draft.player.id) {
        error(issues, `${path}.presentation.playerActorId`, "invalid_galgame_player", "Galgame 演出需要指定当前世界的玩家 Actor。");
      }
      required(issues, context.presentation.artDirection, `${path}.presentation.artDirection`, "missing_art_direction", "Galgame 演出需要填写美术方向。");
    }
    if (draft.runtimeProfile === "world_story" || context.presentation?.kind === "galgame") {
      const card = draft.player?.playerCard;
      for (const [field, label] of [["name", "姓名"], ["identity", "身份"], ["background", "公开背景"], ["personality", "性格"], ["appearance", "外观"], ["speechStyle", "表达方式"], ["boundaries", "边界"]] as const) {
        required(issues, card?.[field], `player.playerCard.${field}`, `missing_player_card_${field}`, `进入世界前请完善玩家角色卡：${label}。`);
      }
    }
    for (const actorId of context.actorIds ?? []) {
      if (!actorIds.has(actorId)) {
        error(issues, `${path}.actorIds`, "unknown_actor_reference", `Context 引用了未知 Actor：${actorId}`);
      }
    }
    if (draft.runtimeProfile === "world_story" && draft.player) {
      if (!context.actorIds.includes(draft.player.id)) {
        error(
          issues,
          `${path}.actorIds`,
          "missing_player_context_actor",
          "叙事世界的当前 Context 必须包含玩家 Actor，才能进入演出。",
        );
      }
      if (!draft.actors.some((actor) => context.actorIds.includes(actor.id))) {
        error(
          issues,
          `${path}.actorIds`,
          "missing_context_actor",
          "叙事世界的当前 Context 至少需要一个 AI 角色，才能开始演出。",
        );
      }
    }
  }

  for (const [index, relation] of draft.relations.entries()) {
    const path = `relations.${index}`;
    addUniqueId(issues, relationIds, relation.id, `${path}.id`, "relation_id_duplicate");
    if (!actorIds.has(relation.fromActorId)) {
      error(issues, `${path}.fromActorId`, "unknown_actor_reference", `关系起点不存在：${relation.fromActorId}`);
    }
    if (!actorIds.has(relation.toActorId)) {
      error(issues, `${path}.toActorId`, "unknown_actor_reference", `关系终点不存在：${relation.toActorId}`);
    }
    if (relation.fromActorId === relation.toActorId) {
      warning(issues, path, "self_relation", "角色关系的起点和终点相同。");
    }
    required(issues, relation.description, `${path}.description`, "missing_relation_description", "关系缺少描述。");
  }

  let activeChapterCount = 0;
  let queuedChapterCount = 0;
  for (const [index, chapter] of draft.chapters.entries()) {
    const path = `chapters.${index}`;
    addUniqueId(issues, chapterIds, chapter.id, `${path}.id`, "chapter_id_duplicate");
    required(issues, chapter.title, `${path}.title`, "missing_chapter_title", "章节缺少标题。");
    required(issues, chapter.treatment, `${path}.treatment`, "missing_chapter_treatment", "章节缺少长期剧情纲要。");
    required(issues, chapter.targetOutcome, `${path}.targetOutcome`, "missing_chapter_outcome", "章节缺少可观察的阶段性结果。");
    if (chapter.status === "active") activeChapterCount += 1;
    if (chapter.status === "queued") queuedChapterCount += 1;
    if (chapter.treatment.trim().length < 600) {
      warning(issues, `${path}.treatment`, "short_chapter_treatment", "章节纲要偏短，可能只能承载一两个 Beat；建议补充局面、矛盾、力量、约束和推进空间。 ");
    }
    if (chapter.treatment.trim().length > 1500) {
      warning(issues, `${path}.treatment`, "long_chapter_treatment", "章节纲要偏长，建议压缩为 Director 可长期读取的 600-1500 字主干。 ");
    }
    if (/^(知道|找到|解决|完成|见面|对话|调查)/.test(chapter.targetOutcome.trim()) || chapter.targetOutcome.trim().length < 16) {
      warning(issues, `${path}.targetOutcome`, "thin_chapter_outcome", "章节结果过于局部或抽象，建议写成能改变世界状态的阶段性成果。 ");
    }
    for (const actorId of chapter.actorIds ?? []) {
      if (!actorIds.has(actorId)) {
        error(issues, `${path}.actorIds`, "unknown_actor_reference", `章节引用了未知 Actor：${actorId}`);
      }
    }
    for (const contextId of chapter.contextIds ?? []) {
      if (!contextIds.has(contextId)) {
        error(issues, `${path}.contextIds`, "unknown_context_reference", `章节引用了未知 Context：${contextId}`);
      }
    }
  }

  if (draft.runtimeProfile === "world_story" && draft.chapters.length === 0) {
    error(issues, "chapters", "missing_chapter", "叙事世界至少需要一个初始章节。");
  } else if (draft.runtimeProfile === "world_story" && activeChapterCount !== 1) {
    error(issues, "chapters", "active_chapter_count", "叙事世界必须恰好有一个 active 章节，其余章节应为 queued。");
  } else if (draft.runtimeProfile === "world_story" && queuedChapterCount < 1) {
    error(issues, "chapters", "missing_queued_chapters", "叙事世界至少需要一个 queued 章节，才能为 Director 提供后续阶段。");
  } else if (draft.runtimeProfile === "world_story" && queuedChapterCount > 3) {
    error(issues, "chapters", "too_many_queued_chapters", "叙事世界最多准备三个 queued 章节，请把更远的剧情留给 Director 后续创建。");
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function addUniqueId(
  issues: DraftValidationIssue[],
  set: Set<string>,
  value: unknown,
  path: string,
  code: string,
): void {
  const id = textValue(value);
  if (!id) {
    error(issues, path, "missing_id", "缺少稳定 ID。");
    return;
  }
  if (set.has(id)) {
    error(issues, path, code, `ID 重复：${id}`);
    return;
  }
  set.add(id);
}

function required(
  issues: DraftValidationIssue[],
  value: unknown,
  path: string,
  code: string,
  message: string,
): void {
  if (!textValue(value)) error(issues, path, code, message);
}

function error(
  issues: DraftValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ code, severity: "error", path, message });
}

function warning(
  issues: DraftValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ code, severity: "warning", path, message });
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
