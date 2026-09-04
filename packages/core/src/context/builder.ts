import type {
  LoreBook,
  LoreBookEntry,
  SceneCard,
  CharacterCard,
  Relation,
  ChatMessage,
  ActorAction,
} from "../contracts/chat.js";
import type { CharacterState } from "../contracts/chat.js";
import type { HumanParticipant } from "../engine/input/types.js";
import type { ConversationDigest } from "./conversation.js";
import type { ActorMemorySlice } from "../contracts/actor-memory.js";
import type { NarrativeNarration } from "../contracts/world.js";
import { projectConversationHistory } from "./conversation.js";
import { formatContextTimeline, projectChatTimeline } from "./timeline.js";
import {
  CHARACTER_SYSTEM_PROMPT,
  CHARACTER_NATURALNESS_PROMPT,
  WORLD_ACTOR_NATURALNESS_PROMPT,
  WORLD_ACTOR_SYSTEM_PROMPT,
  PRIVATE_WORLD_ACTOR_SYSTEM_PROMPT,
} from "./prompts.js";

const ACTOR_HISTORY_MAX_CHARS = 3_600;
const ACTOR_DIGEST_SUMMARY_MAX_CHARS = 2_400;
const ACTOR_DIGEST_FACT_LIMIT = 8;
const ACTOR_DIGEST_FACT_MAX_CHARS = 320;

// ── 输入 & 输出 ──

/** ContextBuilder 的静态输入，在互动上下文创建后保持不变。 */
export interface ContextInput {
  actorPromptMode?: "group" | "world";
  conversationMode?: "group" | "private";
  /**
   * Shared authoring lore. Group characters may read it in full;
   * World Actors learn world facts through their own card, private lore,
   * recalled memory, narration, events, and observed history.
   */
  worldBook?: LoreBook;
  scene: SceneCard;
  characters: CharacterCard[];
  humans: HumanParticipant[];
  relations: Relation[];
  getCharacterStates: () => readonly CharacterState[];
  getConversationDigest?: () => ConversationDigest;
  getActorMemory?: (characterName: string, messages: readonly ChatMessage[]) => ActorMemorySlice | undefined;
  getActorWorldBackground?: (characterName: string) => string | undefined;
  getCurrentWorldScene?: () => NarrativeNarration | undefined;
  /** 增量时间线块,置于所有 world Actor 提示词最前(共享前缀);未提供时保持旧布局。 */
  getWorldTimeline?: (characterName: string) => string | undefined;
  projectCharacterHistory?: (
    characterName: string,
    messages: readonly ChatMessage[],
    actions: readonly ActorAction[],
  ) => {
    messages: readonly ChatMessage[];
    actions: readonly ActorAction[];
    includeDigest: boolean;
  };
}

/** 可直接传给 Provider 的完整 Prompt。 */
export interface AssembledPrompt {
  systemPrompt: string;
  userPrompt: string;
}

// ── System Prompts（从 prompts.ts 导入）──

// ── Builder ──

/** Builds Actor prompts without calling a model or mutating runtime state. */
export class ContextBuilder {
  /** Static context shared by Actor prompt builds. */
  readonly input: ContextInput;

  constructor(input: ContextInput) {
    this.input = input;
  }

  buildHarnessCharacter(
    characterName: string,
    messages: readonly ChatMessage[],
    actions: readonly ActorAction[] = [],
  ): AssembledPrompt {
    const character = this.input.characters.find((c) => c.name === characterName);
    if (!character) {
      throw new Error(`Character "${characterName}" not found in session`);
    }

    const prompts = this.characterBehaviorPrompts();
    if (this.input.actorPromptMode === "world") {
      return {
        systemPrompt: joinPromptSections([
          this.input.conversationMode === "private"
            ? PRIVATE_WORLD_ACTOR_SYSTEM_PROMPT
            : "",
          prompts.system,
          prompts.naturalness,
        ]),
        userPrompt: this.buildWorldCharacterUserPrompt(
          character,
          messages,
          actions,
        ),
      };
    }
    return {
      systemPrompt: joinPromptSections([
        prompts.system,
        prompts.naturalness,
      ]),
      userPrompt: joinPromptSections([
        this.assembleCharacterWorldBook(),
        this.assembleScene(),
        this.assembleOneCharacterFull(character),
        this.assembleActorMemory(characterName, messages),
        this.assembleLoreBook(character, messages, "before"),
        this.assembleLoreBook(character, messages, "after"),
        this.assembleOtherCharactersCondensed(characterName),
        this.assembleHumansFull(),
        this.assembleCharacterStatuses(characterName),
        this.assembleOwnRelations(characterName),
        this.assembleHistory(messages, actions, characterName),
      ]),
    };
  }

  /**
   * World prompts are ordered from stable shared context to per-turn state.
   * This preserves the longest possible provider prefix across Actors and turns.
   */
  private buildWorldCharacterUserPrompt(
    character: CharacterCard,
    messages: readonly ChatMessage[],
    _actions: readonly ActorAction[],
  ): string {
    const timelineBlock = this.input.getWorldTimeline?.(character.name);
    const memorySlice = this.input.getActorMemory?.(character.name, messages);
    return joinPromptSections([
      // Stable context and Actor identity form the cacheable prefix.
      this.assembleWorldContextIdentity(),
      this.assembleOneCharacterFull(character),
      this.assembleOwnRelations(character.name),
      this.assembleActorWorldBackground(character),
      this.assembleLoreBook(character, messages, "before"),
      this.assembleLoreBook(character, messages, "after"),
      this.assembleActorMemory(character.name, messages, memorySlice),

      // Append-only and per-turn state stay after the Actor-specific prefix.
      timelineBlock ? `【时间线】\n${timelineBlock}` : "",
      this.assembleScene(),
      this.assembleWorldParticipants(),
      this.assembleCharacterStatuses(character.name),
    ]);
  }

  // ── 各组件拼装（private）──

  private characterBehaviorPrompts(): { system: string; naturalness: string } {
    return this.input.actorPromptMode === "world"
      ? { system: WORLD_ACTOR_SYSTEM_PROMPT, naturalness: WORLD_ACTOR_NATURALNESS_PROMPT }
      : { system: CHARACTER_SYSTEM_PROMPT, naturalness: CHARACTER_NATURALNESS_PROMPT };
  }

  private assembleWorldBook(): string {
    const wb = this.input.worldBook;
    if (!wb) return "";

    const desc = wb.description ? `\n${wb.description}` : "";
    const entries = wb.entries.map(formatLoreBookEntry).join("\n");
    return `【世界观${wb.name ?? ""}${desc}\n${entries}`;
  }

  /**
   * A World Actor must not inherit the author's omniscient lore.
   * Group Actors intentionally receive the shared world book.
   */
  private assembleCharacterWorldBook(): string {
    return this.input.actorPromptMode === "world"
      ? ""
      : this.assembleWorldBook();
  }

  private assembleScene(): string {
    const s = this.input.scene;
    const rules = s.rules?.length ? `\n特殊规则：${s.rules.join("，")}` : "";
    // The default state is meaningful to agents too: without it, a Harness
    // character cannot distinguish an active conversation from a settled one.
    if (this.input.actorPromptMode === "world") {
      const scene = this.input.getCurrentWorldScene?.();
      if (scene) {
        return `【当前剧情节点：${s.groupName}】\n${scene.text}`;
      }
      return `【当前剧情节点：${s.groupName}】\n${s.atmosphere}\n${s.topic}`;
    }
    const stateHint = `\n对话状态：${s.state ?? "flowing"}`;
    return `【群聊：${s.groupName}】\n话题：${s.topic}\n氛围：${s.atmosphere}${stateHint}${rules}`;
  }

  private assembleWorldContextIdentity(): string {
    const rules = this.input.scene.rules?.length
      ? `\n场景规则：${this.input.scene.rules.join("，")}`
      : "";
    return `【互动上下文：${this.input.scene.groupName}】${rules}`;
  }

  private assembleWorldParticipants(): string {
    const actorNames = this.input.characters.map((character) => character.name);
    const humanNames = this.input.humans.map((human) => human.name);
    return joinPromptSections([
      [
        "【当前参与者】",
        `AI 角色：${actorNames.join("、") || "无"}`,
        `真人参与者：${humanNames.join("、") || "无"}`,
      ].join("\n"),
      this.assembleHumansFull(),
    ]);
  }

  /** 角色专属世界书：包含关键词命中条目和 constant 条目。 */
  private assembleLoreBook(
    character: CharacterCard,
    messages: readonly ChatMessage[],
    position: "before" | "after",
  ): string {
    const lb = character.loreBook;
    if (!lb?.entries.length) return "";

    const worldScene = this.input.actorPromptMode === "world"
      ? this.input.getCurrentWorldScene?.()?.text
      : undefined;
    const actorBackground = this.input.actorPromptMode === "world"
      ? this.input.getActorWorldBackground?.(character.name) ?? character.scenario
      : "";
    const recentText = [
      actorBackground,
      worldScene ?? "",
      ...messages.slice(-20).map((message) => message.message),
    ].join(" ");

    const activeEntries = lb.entries
      .filter((e) => e.position === position)
      .filter((e) => e.constant || e.keys.some((k) => recentText.includes(k)))
      .sort((a, b) => a.priority - b.priority);

    if (!activeEntries.length) return "";
    return activeEntries.map((e) => e.content).join("\n");
  }

  /** 只输出值得进入上下文的角色运行时状态，省略无信息的默认状态。 */
  private assembleCharacterStatuses(viewerName?: string): string {
    const states = this.input.getCharacterStates();
    if (!states.length) return "";
    const isWorldActor = this.input.actorPromptMode === "world" && viewerName;
    const notable = states.filter((s) => {
      if (isWorldActor && s.characterName !== viewerName) {
        return s.availability !== "available";
      }
      if (s.availability !== "available") return true;
      if (s.attention !== "active") return true;
      if (s.mood || s.intent || s.note) return true;
      return false;
    });
    if (!notable.length) return "";
    const lines = notable.map((s) => {
      const parts: string[] = [];
      if (s.availability !== "available") {
        parts.push(s.availability === "unavailable" ? "不可参与" : "暂时离开");
      }
      if (s.attention !== "active") {
        parts.push(s.attention === "lurking" ? "潜水" : "走神");
      }
      if (!isWorldActor || s.characterName === viewerName) {
        if (s.mood) parts.push(`心情${s.mood}`);
        if (s.intent) parts.push(`意图${s.intent}`);
        if (s.note) parts.push(`备注${s.note}`);
      }
      return `${s.characterName}${parts.join(" | ")}`;
    });
    const title = isWorldActor ? "【你能观察到的角色状态】" : "【角色状态】";
    return `${title}\n${lines.join("\n")}`;
  }

  /** 当前 Actor 自己的完整角色卡。 */
  private assembleOneCharacterFull(character: CharacterCard): string {
    if (this.input.actorPromptMode === "world") {
      const parts = [
        `【你的角色身份：${character.name}】`,
        `角色简介：${character.description}`,
        `性格与习惯：${character.personality}`,
      ];
      if (character.messageExample) {
        parts.push(`语言示例（只参考语气，不照抄内容）：\n${character.messageExample}`);
      }
      if (character.instructions) {
        parts.push(`角色专属行为约束：\n${character.instructions}`);
      }
      return parts.join("\n");
    }
    const parts = [
      `【你的角色：${character.name}】`,
      `简介：${character.description}`,
      `性格${character.personality}`,
      `场景认知${character.scenario}`,
    ];

    if (character.messageExample) {
      parts.push(`对话示例（参考语气）：\n${character.messageExample}`);
    }
    if (character.instructions) {
      parts.push(`角色专属行为约束：\n${character.instructions}`);
    }

    return parts.join("\n");
  }

  private assembleActorWorldBackground(character: CharacterCard): string {
    if (this.input.actorPromptMode !== "world") return "";
    const background = this.input.getActorWorldBackground?.(character.name) ??
      character.scenario;
    return `【你在这个世界中的背景与既有认知】\n${background}`;
  }

  /** Only the resolver-selected slice enters an Actor prompt. */
  private assembleActorMemory(
    characterName: string,
    messages: readonly ChatMessage[],
    resolvedSlice?: ActorMemorySlice,
  ): string {
    const slice = resolvedSlice ?? this.input.getActorMemory?.(characterName, messages);
    const recalled = slice?.entries.filter(({ node }) => node.kind !== "relation") ?? [];
    if (!recalled.length) return "";
    const entries = recalled.map(({ node }) => {
      const kind = node.kind === "commitment"
        ? "未完成承诺"
        : node.kind === "preference"
          ? "稳定偏好"
          : node.kind === "belief"
            ? "当前认知"
            : node.kind === "self"
              ? "自我认知"
              : node.kind === "knowledge"
                ? "已知信息"
                : "重要经历";
      return `- [${kind}] ${node.title}: ${node.content}`;
    });
    return `【你的相关长期记忆】\n${entries.join("\n")}`;
  }

  /** 群聊模式下提供其他角色的精简身份信息。 */
  private assembleOtherCharactersCondensed(excludeName: string): string {
    const others = this.input.characters.filter((c) => c.name !== excludeName);
    if (!others.length) return "";

    if (this.input.actorPromptMode === "world") {
      return `【当前互动中的其他角色】\n${others.map((character) => character.name).join("\n")}`;
    }
    const cards = others.map((c) => `${c.name}${c.description}`);
    return `【群里的其他人】\n${cards.join("\n")}`;
  }

  /** 真人成员卡只提供身份信息，不允许 Actor 代替真人发言。 */
  private assembleHumansFull(): string {
    if (!this.input.humans.length) return "";

    const cards = this.input.humans.map(formatHumanFull);
    const title = this.input.actorPromptMode === "world" ? "【当前场景中的真人参与者】" : "【真人成员】";
    return `${title}\n${cards.join("\n\n")}`;
  }

  /** Actor 只读取自己指向他人的关系，不反推别人对自己的认知。 */
  private assembleOwnRelations(characterName: string): string {
    const own = this.input.relations.filter((relation) => relation.from === characterName);
    if (!own.length) {
      return this.input.actorPromptMode === "world"
        ? "【你在这个世界中的关系】\n当前没有已确认的单向关系；只根据亲历互动形成判断。"
        : "";
    }

    const lines = own.map((relation) => `你对${relation.to}${relation.description}`);
    const title = this.input.actorPromptMode === "world" ? "【你在这个世界中的关系】" : "【你和其他人的关系】";
    return `${title}\n${lines.join("\n")}`;
  }

  /** 聊天记录 */
  private assembleHistory(
    messages: readonly ChatMessage[],
    actions: readonly ActorAction[] = [],
    characterName?: string,
  ): string {
    const projected = characterName
      ? this.input.projectCharacterHistory?.(characterName, messages, actions)
      : undefined;
    const visibleMessages = projected?.messages ?? messages;
    const visibleActions = projected?.actions ?? actions;
    const isWorld = this.input.actorPromptMode === "world";
    if (!visibleMessages.length && !visibleActions.length) {
      return isWorld
        ? "（当前互动场景刚刚开始，还没有已提交的角色行动或话语。）"
        : "（群聊刚刚开始，还没有人说话。）";
    }
    const digest = projected?.includeDigest === false
      ? undefined
      : this.input.getConversationDigest?.();
    if (!digest) {
      const title = isWorld ? "【最近互动记录】" : "【聊天记录】";
      return `${title}\n${formatContextTimeline(projectChatTimeline(visibleMessages, visibleActions), ACTOR_HISTORY_MAX_CHARS)}`;
    }

    const projection = projectConversationHistory(visibleMessages, digest);
    const sections: string[] = [];
    if (projection.digest.summary) {
      sections.push(`【较早对话摘要】\n${projection.digest.summary.slice(0, ACTOR_DIGEST_SUMMARY_MAX_CHARS)}`);
    }
    if (projection.digest.recentFacts.length) {
      const facts = projection.digest.recentFacts
        .slice(-ACTOR_DIGEST_FACT_LIMIT)
        .map((fact) => `- ${fact.slice(0, ACTOR_DIGEST_FACT_MAX_CHARS)}`);
      sections.push(`【仍有效的近期事实】\n${facts.join("\n")}`);
    }
    if (projection.recentMessages.length) {
      const title = isWorld ? "【最近互动记录】" : "【最近聊天记录】";
      sections.push(`${title}\n${formatContextTimeline(projectChatTimeline(projection.recentMessages, visibleActions), ACTOR_HISTORY_MAX_CHARS)}`);
    } else if (visibleActions.length) {
      sections.push(`【最近角色动作】\n${formatContextTimeline(projectChatTimeline([], visibleActions), ACTOR_HISTORY_MAX_CHARS)}`);
    }
    return sections.join("\n\n") || (
      isWorld
        ? "（当前互动场景刚刚开始，还没有已提交的角色行动或话语。）"
        : "（群聊刚刚开始，还没有人说话。）"
    );
  }
}

function joinPromptSections(sections: Array<string | undefined>): string {
  return sections.filter(Boolean).join("\n\n");
}

function formatLoreBookEntry(entry: LoreBookEntry): string {
  const keys = entry.keys.length ? `关键词：${entry.keys.join("，")}；` : "";
  return `- ${keys}${entry.content}`;
}

function formatHumanFull(human: HumanParticipant): string {
  const parts = [
    `${human.name}】真人成员`,
    human.card ? `成员卡：${human.card}` : undefined,
    "注意：这是真人用户，只能由用户自己发言。你可以回应 TA，但不要替 TA 说话。",
  ].filter(Boolean);
  return parts.join("\n");
}
