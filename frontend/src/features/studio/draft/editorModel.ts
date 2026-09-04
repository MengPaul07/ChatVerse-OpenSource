import type { WorldDraft, WorldDraftOperation } from "@chatverse/world-authoring";

export type EditorState =
  | { kind: "foundation"; name: string; description: string; premise: string; tone: string; loreCore: string; rules: string }
  | { kind: "player"; mode: "participant" | "observer" | "director"; name: string; identity: string; background: string; personality: string; appearance: string; speechStyle: string; boundaries: string }
  | { kind: "actor"; id?: string; role: "lead" | "support"; name: string; description: string; personality: string; scenario: string; background: string; messageExample: string; instructions: string }
  | { kind: "relation"; id: string; fromActorId: string; toActorId: string; description: string }
  | { kind: "context"; id: string; name: string; topic: string; atmosphere: string; opening: string; rules: string; presentationKind: "standard" | "galgame"; artDirection: string }
  | { kind: "chapter"; id: string; title: string; treatment: string; targetOutcome: string };

export function createEditorState(
  draft: WorldDraft,
  kind: EditorState["kind"],
  id?: string,
): EditorState {
  if (kind === "foundation") {
    return {
      kind,
      name: draft.metadata.name,
      description: draft.metadata.description,
      premise: draft.premise,
      tone: draft.metadata.tone ?? "",
      loreCore: draft.lore.core,
      rules: draft.lore.rules.join("\n"),
    };
  }
  if (kind === "player") {
    const card = draft.player?.playerCard;
    return {
      kind,
      mode: draft.player?.mode ?? "participant",
      name: card?.name ?? draft.player?.profile.name ?? "",
      identity: card?.identity ?? "",
      background: card?.background ?? draft.player?.profile.card ?? "",
      personality: card?.personality ?? "",
      appearance: card?.appearance ?? "",
      speechStyle: card?.speechStyle ?? "",
      boundaries: card?.boundaries ?? "无",
    };
  }
  if (kind === "actor") {
    if (!id) {
      return {
        kind,
        role: "support",
        name: "",
        description: "",
        personality: "",
        scenario: "",
        background: "",
        messageExample: "",
        instructions: "",
      };
    }
    const actor = draft.actors.find((item) => item.id === id);
    if (!actor) throw new Error("找不到这个角色。");
    return {
      kind,
      id: actor.id,
      role: actor.role,
      name: actor.card.name,
      description: actor.card.description,
      personality: actor.card.personality,
      scenario: actor.card.scenario,
      background: actor.background ?? actor.card.scenario,
      messageExample: actor.card.messageExample,
      instructions: actor.card.instructions ?? "",
    };
  }
  if (!id) throw new Error("缺少要编辑的对象。");
  if (kind === "relation") {
    const relation = draft.relations.find((item) => item.id === id);
    if (!relation) throw new Error("找不到这条关系。");
    return { kind, ...relation };
  }
  if (kind === "context") {
    const context = draft.contexts.find((item) => item.id === id);
    if (!context) throw new Error("找不到这个开场场景。");
    return {
      kind,
      id: context.id,
      name: context.name,
      topic: context.scene.topic,
      atmosphere: context.scene.atmosphere,
      opening: context.opening,
      rules: (context.scene.rules ?? []).join("\n"),
      presentationKind: context.presentation?.kind === "galgame" ? "galgame" : "standard",
      artDirection: context.presentation?.artDirection ?? "电影感二维动画，克制的色彩，细腻光影，统一角色设计",
    };
  }
  const chapter = draft.chapters.find((item) => item.id === id);
  if (!chapter) throw new Error("找不到这个剧情章节。");
  return { kind, id: chapter.id, title: chapter.title, treatment: chapter.treatment, targetOutcome: chapter.targetOutcome };
}

export function editorOperations(editor: EditorState, draft: WorldDraft): WorldDraftOperation[] {
  switch (editor.kind) {
    case "foundation":
      return [
        { type: "set_metadata", metadata: { name: editor.name.trim(), description: editor.description.trim(), tone: editor.tone.trim() || undefined } },
        { type: "set_premise", premise: editor.premise.trim() },
        { type: "set_lore", lore: { core: editor.loreCore.trim(), rules: splitLines(editor.rules) } },
      ];
    case "player": {
      const playerAlias = draft.player?.id ?? "manual-player";
      const operations: WorldDraftOperation[] = [{
        type: "upsert_player",
        player: {
          id: playerAlias,
          mode: editor.mode,
          profile: { name: editor.name.trim(), card: editor.background.trim() },
          playerCard: {
            name: editor.name.trim(), identity: editor.identity.trim(), background: editor.background.trim(),
            personality: editor.personality.trim(), appearance: editor.appearance.trim(),
            speechStyle: editor.speechStyle.trim(), boundaries: editor.boundaries.trim(),
          },
        },
      }];
      for (const context of draft.contexts) {
        if (context.presentation?.kind !== "galgame" || context.presentation.playerActorId === playerAlias) continue;
        operations.push({ type: "upsert_context", context: { ...context, presentation: { ...context.presentation, playerActorId: playerAlias } } });
      }
      return operations;
    }
    case "actor": {
      const actor = editor.id ? draft.actors.find((item) => item.id === editor.id) : undefined;
      if (editor.id && !actor) throw new Error("角色在保存前已经不存在。");
      const actorAlias = actor?.id ?? "manual-new-actor";
      const operations: WorldDraftOperation[] = [{
        type: "upsert_actor",
        actor: {
          id: actorAlias,
          role: editor.role,
          background: editor.background.trim() || editor.scenario.trim(),
          card: {
            ...actor?.card,
            name: editor.name.trim(), description: editor.description.trim(), personality: editor.personality.trim(),
            scenario: editor.scenario.trim(), messageExample: editor.messageExample.trim(),
            instructions: editor.instructions.trim() || undefined,
          },
        },
      }];
      const context = draft.contexts[0];
      if (!actor && context) {
        operations.push({ type: "upsert_context", context: { ...context, actorIds: [...new Set([...context.actorIds, actorAlias])] } });
      }
      return operations;
    }
    case "relation":
      return [{ type: "upsert_relation", relation: { id: editor.id, fromActorId: editor.fromActorId, toActorId: editor.toActorId, description: editor.description.trim() } }];
    case "context": {
      const context = draft.contexts.find((item) => item.id === editor.id);
      if (!context) throw new Error("开场场景在保存前已经不存在。");
      return [{
        type: "upsert_context",
        context: {
          id: context.id,
          name: editor.name.trim(),
          actorIds: context.actorIds,
          scene: { ...context.scene, groupName: editor.name.trim(), topic: editor.topic.trim(), atmosphere: editor.atmosphere.trim(), rules: splitLines(editor.rules) },
          opening: editor.opening.trim(),
          lore: context.lore,
          presentation: editor.presentationKind === "galgame"
            ? { kind: "galgame", playerActorId: draft.player?.id ?? "", artDirection: editor.artDirection.trim(), backgroundGeneration: "auto", acknowledgement: "required" }
            : undefined,
        },
      }];
    }
    case "chapter": {
      const chapter = draft.chapters.find((item) => item.id === editor.id);
      if (!chapter) throw new Error("剧情章节在保存前已经不存在。");
      return [{ type: "upsert_chapter", chapter: { id: chapter.id, title: editor.title.trim(), treatment: editor.treatment.trim(), targetOutcome: editor.targetOutcome.trim(), status: chapter.status, actorIds: chapter.actorIds, contextIds: chapter.contextIds } }];
    }
  }
}

export function editorSummary(editor: EditorState): string {
  switch (editor.kind) {
    case "foundation": return "手动编辑世界核心";
    case "player": return `手动编辑玩家角色：${editor.name.trim() || "未命名玩家"}`;
    case "actor": return `手动编辑角色：${editor.name.trim() || "未命名角色"}`;
    case "relation": return "手动编辑角色关系";
    case "context": return "手动编辑开场场景";
    case "chapter": return `手动编辑剧情章节：${editor.title.trim() || "未命名章节"}`;
  }
}

export function playerModeCopy(mode: "participant" | "observer" | "director"): string {
  if (mode === "observer") return "旁观者";
  if (mode === "director") return "导演视角";
  return "亲自参与";
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
