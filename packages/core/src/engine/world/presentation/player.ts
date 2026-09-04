import type { ChatProvider } from "../../../contracts/provider.js";
import type {
  NarrativeBeat,
  PlayerCharacterCard,
  PlayerPerformanceOption,
  PlayerTurnProposal,
} from "../../../contracts/world.js";

export interface PlayerTurnView {
  proposalId: string;
  contextId: string;
  actorId: string;
  beat: NarrativeBeat;
  sceneNow: string;
  recentEvents: string;
  cast: string;
  prompt?: string;
  guidance?: string;
  card: PlayerCharacterCard;
  maxTokens?: number;
}

const PLAYER_TURN_SYSTEM_PROMPT = [
  "你是玩家角色的演出提案器，不是剧情导演，也不能替玩家直接提交决定。",
  "根据玩家角色卡、当前幕、现场、最近事件和 Narrator 给出的决策问题，提供 2 至 3 个真正值得选择的表演选项，并给出一个自动代演选项。",
  "每项至少包含 message 或 action；不得突破玩家边界，不得擅自改写客观世界事实。",
  "玩家卡中的身份、背景、权限、能力和资源是硬边界。不得因为当前场景是军营、法庭、实验室等专业环境，就擅自把玩家写成将领、官员、专家或组织成员。",
  "不得生成玩家卡没有依据的自称、职权、专业知识、既有人脉或可调动资源。外来者、穿越者或访客只能以当前已经建立的身份提出观察、疑问、建议或行动。",
  "每个选项必须直接处理当前决策问题或矛盾，并在立场、策略或承担的风险上有实质区别；label 要概括区别，performance 要给出可直接演出的具体表达。",
  "禁止用换一种说法重复同一选择；禁止泛泛观察、附和、复述现状、无目的等待或再次询问已经得到答案。界面另有跳过，不要生成跳过或沉默选项。",
  "选项只描述玩家自己说什么或做什么，不负责选择下一位回应者，不输出 actorId、调度说明或隐藏目标。",
  "action 只写玩家本人可观察的动作，不把对白塞进 action；message 只写玩家要说的话。",
  "普通世界页和演出页使用同一个玩家回合；即使当前不是演出舞台，也必须先给出可选择的建议。",
  "建议保持简短、可直接提交，优先围绕当前 Narrator 指令提供两种不同策略；不要输出思考过程、Markdown 或代码围栏。",
  "只输出 JSON：{suggestions:[{label,performance:{message?,action?}}],autoPerformance:{label,performance:{message?,action?}}}。",
].join("\n");

export class PlayerTurnAgent {
  private responseFormatSupported: boolean | undefined;

  constructor(private readonly provider: ChatProvider) {}

  async propose(view: PlayerTurnView, signal?: AbortSignal): Promise<PlayerTurnProposal> {
    const userPrompt = buildPrompt(view);
    const request = {
      systemPrompt: PLAYER_TURN_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: view.maxTokens ?? 1_200,
      thinking: "disabled" as const,
      signal,
      requestContext: {
        purpose: "player_actor" as const,
        turnId: view.proposalId,
        contextId: view.contextId,
      },
    };
    const raw = await this.complete(request);
    try {
      return parseProposal(raw, view);
    } catch (error) {
      const repairedRaw = await this.complete({
        ...request,
        userPrompt: [
          userPrompt,
          "",
          "[输出修复]",
          `上一份输出无法解析或选项不足：${errorMessage(error)}`,
          `上一份输出：${truncate(raw, 700)}`,
          "只返回完整 JSON；重新提供至少两个策略明显不同的建议和一个自动代演选项。不要解释，不要代码围栏，不要添加调度字段。",
        ].join("\n"),
      });
      return parseProposal(repairedRaw, view);
    }
  }

  private async complete(
    request: Omit<Parameters<ChatProvider["complete"]>[0], "responseFormat">,
  ): Promise<string> {
    if (this.responseFormatSupported === false) {
      return this.provider.complete(request);
    }
    try {
      const response = await this.provider.complete({
        ...request,
        responseFormat: { type: "json_object" },
      });
      this.responseFormatSupported = true;
      return response;
    } catch (error) {
      if (!isResponseFormatUnsupported(error)) throw error;
      this.responseFormatSupported = false;
      return this.provider.complete(request);
    }
  }
}

function buildPrompt(view: PlayerTurnView): string {
  const card = view.card;
  return [
    `[Player card]\nname=${card.name}\nidentity=${card.identity}\nbackground=${card.background}\npersonality=${card.personality}\nappearance=${card.appearance}\nspeechStyle=${card.speechStyle}\nboundaries=${card.boundaries}`,
    `[Beat script]\ntitle=${view.beat.title}\nbrief=${view.beat.brief}\ntime=${view.beat.script.time}\nlocation=${view.beat.script.location}\nyour role=${view.beat.script.cast.find((item) => item.actorId === view.actorId)?.roleInScene ?? "follow the current scene naturally"}\ncause=${view.beat.script.cause}\ndevelopment=${view.beat.script.development.join(" -> ")}\nturningPoint=${view.beat.script.turningPoint}\nresult=${view.beat.script.result}`,
    `[Scene now]\n${view.sceneNow}`,
    `[Narrator decision]\nprompt=${view.prompt ?? "请根据当前局面采取自然行动"}\nguidance=${view.guidance ?? "保持身份边界，选择有实际区别的行动"}`,
    `[Public cast]\n${view.cast || "(none)"}`,
    `[Recent events]\n${view.recentEvents || "(none)"}`,
  ].join("\n\n");
}

function parseProposal(raw: string, view: PlayerTurnView): PlayerTurnProposal {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  const value = JSON.parse(json) as Record<string, unknown>;
  const rawSuggestions = value.suggestions ?? value.options ?? value.choices;
  const suggestions = Array.isArray(rawSuggestions)
    ? uniqueOptions(rawSuggestions.map(parseOption).filter((item): item is PlayerPerformanceOption => Boolean(item))).slice(0, 3)
    : [];
  const autoPerformance = parseOption(value.autoPerformance ?? value.auto_performance) ?? suggestions[0];
  if (suggestions.length < 2 || !autoPerformance) {
    throw new Error("PlayerTurnAgent returned too few distinct options.");
  }
  return {
    id: view.proposalId,
    contextId: view.contextId,
    beatId: view.beat.id,
    ...(view.prompt ? { prompt: view.prompt } : {}),
    ...(view.guidance ? { guidance: view.guidance } : {}),
    suggestions,
    autoPerformance,
  };
}

function uniqueOptions(options: PlayerPerformanceOption[]): PlayerPerformanceOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.performance.action ?? ""}\n${option.performance.message ?? ""}`
      .replace(/\s+/g, "")
      .toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseOption(value: unknown): PlayerPerformanceOption | undefined {
  if (typeof value === "string") {
    const message = cleanText(value);
    return message
      ? { label: message.slice(0, 40), performance: { message } }
      : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const performance = item.performance && typeof item.performance === "object" && !Array.isArray(item.performance)
    ? item.performance as Record<string, unknown>
    : undefined;
  const message = cleanText(performance?.message)
    ?? cleanText(item.message)
    ?? cleanText(item.text)
    ?? cleanText(item.content);
  const action = cleanText(performance?.action) ?? cleanText(item.action);
  if (!message && !action) return undefined;
  return {
    label: cleanText(item.label)?.slice(0, 40) ?? message?.slice(0, 40) ?? action!.slice(0, 40),
    performance: { ...(message ? { message } : {}), ...(action ? { action } : {}) },
  };
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isResponseFormatUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const text = `${String(candidate.code ?? "")} ${String(candidate.message ?? "")}`;
  return (
    (status === 400 || status === 404 || status === 422) &&
    /(response.?format|json.?object|json.?mode)/i.test(text)
  );
}
