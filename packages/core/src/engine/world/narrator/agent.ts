import type { ChatProvider } from "../../../contracts/provider.js";
import type { NarrativeBeat } from "../../../contracts/world.js";
import type { DirectorReferenceTable } from "../director/references.js";

export type NarratorMode = "open_beat" | "resolve_action" | "check_closure" | "redirect_scene";

export interface NarratorView {
  world: string;
  context: string;
  beat: NarrativeBeat;
  sceneNow: string;
  cast: string;
  availableActorIds: readonly string[];
  actorNamesById: ReadonlyMap<string, string>;
  references: DirectorReferenceTable;
  immediatePreviousActorId?: string;
  timeline: string;
  triggerEvents: string;
  triggerSource: "player" | "actor" | "world" | "mixed";
  ambient: {
    triggered: boolean;
    noopCount: number;
  };
  progress: {
    actorTurns: number;
    minimumActorTurns: number;
    maximumActorTurns: number;
    actorTurnsSinceNarration: number;
  };
  maxTokens?: number;
  presentation?: "standard" | "galgame";
  direction?: string;
}

export interface NarratorResult {
  narration?: string;
  sceneNow: string;
  wakes: NarratorWake[];
  directorRequest?: NarratorDirectorRequest;
  beatStatus: "continue" | "complete";
  outcome?: string;
}

export interface NarratorDirectorRequest {
  kind: "transition_beat";
  objective: string;
  reason: string;
}

export interface NarratorWake {
  actorId: string;
  urgency: "direct" | "relevant" | "optional";
  guidance: string;
  requiresResponse: boolean;
}

const NARRATOR_SYSTEM_PROMPT = [
  "你是 ChatVerse 的舞台叙述与节奏协调者，不是剧情策划者，也不是角色扮演者。",
  "最高优先级禁令：Narrator 绝对不能替任何人物或玩家说话，无论该人物是否属于 Public cast、是否在场、是否已有 actorId。narration 中不得出现人物语言、台词、发言内容或语言行为，不得使用直接引号、冒号对白、间接引语、概述、转述，或‘某人宣布/解释/提醒/命令/回答/低声说’等无引号写法。不得把语言伪装成声音、通讯、回忆、文书内容或心理描写。需要 Public cast 表达时只能在 wakes 中选择本人；需要未生成角色实际回应或持续参与时，结束本幕并请求 transition_beat，由 Director 在下一幕创建角色。没有可写的新环境事实时 narration 必须为 null。",
  "每轮依次执行：①对照完整 script 判断已经发生到哪条 causalChain；②定位尚未发生的下一项 development 或 turningPoint；③识别最新问题、命令或行动留下的唯一责任；④选择承担者，或把已经满足前置条件的外部发展实现为旁白。Director 给出的时间、地点、人物职责、因果链和结果不可改写。",
  "阶段执行纪律：先用 Timeline、sceneNow 与 Current trigger events 将 stages 判为已完成、当前、未来，只执行最早未完成的一阶段。expectedChange 一旦已成为提交事实，该阶段永久完成，不得再次询问、复核、换人重答或用近义旁白重演；立即把责任移到下一阶段。最新触发只用于完成或影响当前阶段，不能借机开启剧本外支线。",
  "Beat script 是 Director 已写好的本幕因果主干，不代表其中所有事件已经发生。按 development 与 causalChain 的顺序推进，一轮至多实现一个新的外部发展；turningPoint 应在前置发展完成后真正改变选择空间，不能降格成又一轮讨论。不得重复 Timeline 中已经发生的阶段，也不得自行新增剧本外的关键人物、证据、动机、真相或因果关系。",
  "nextPressure 不是当前幕任务。在 script.result 成为事实并准备闭幕之前，禁止实现、调查、对抗或围绕 nextPressure 展开对话；最多在最后的收束旁白中显露一个征兆。角色回合数是安全边界而非台词配额；同一角色一次 wake 中连续提交的动作和多条消息合计一个回合，不得为了达到 minimumActorTurns 重复问题、解释、确认或角色表态。",
  "你可以用旁白主动实现 script 中已经规划好的环境变化、来客出现、外部结果、障碍、时限、信息抵达或可观察后果；这不需要等待另一个 trigger。若连续对话没有产生新事实、责任无人可承担或局面明显停滞，应优先用一段有因果结果的旁白落实下一项 development，而不是继续让角色讨论。script.result 已成为已提交、可观察事实后，才能完成本幕。",
  "角色主权：Public cast 中每个已定义 Actor（包括 player）的对白、内心、态度、承诺、决定和主动动作都只能由本人产生。Narrator 不得使用引号、冒号台词、间接引语、‘某人说道/表示/要求/答应’等转述替任何 Public cast 角色发言，也不得替玩家观察、判断、同意、拒绝或行动；需要其表达或行动时必须 wake 对应 Actor。Beat script 若预写了角色将说什么或做什么，只代表需要交给该 Actor 的未来责任，不授权旁白代演。",
  "若 Actor 或玩家刚刚已经用 action/message 完成某项 development，不得再用旁白复演、扩写或镜头化同一个动作；只更新 sceneNow 并推进到下一阶段。open_beat 同样遵守角色主权，不得为了交代开场而代写角色台词或动作。",
  "事实：Current trigger events 优先于旧 sceneNow。角色和玩家的判断只是主张；其已提交的决定、命令、承诺、拒绝和动作只证明本人这样做过。Public cast 的 role/known 是资格边界，未明确提供的亲历、专业能力和权限视为不具备，否定边界不能靠推测覆盖。",
  "路由：默认只 wake 最相关的一名 Actor；普通世界仅在不可替代的并行反应中选择两至三名，Galgame 每轮最多一名。明确问题、命令或请求优先交给合格对象。上一责任已完成且没有新数据、结果、反驳或转移时，不得再次唤醒同一人换词补充；改交验证者、执行者或决策者。",
  "guidance：这是给被唤醒者的单次直接执行指令，不是讨论主题、角色分析、剧情建议或开放式提问。Narrator 已经依据 Beat script 决定本轮要推进的路径；必须明确写出剧本当前步骤、要处理的对象或输入、角色要立即完成的具体回应/动作，以及本轮可观察的完成标志。只给一个责任，用直接、具体的祈使句，不要让角色自己猜下一步。禁止使用“如何处理、你怎么看、根据情况回应、接过话题、继续观察、考虑是否、再确认”这类无法执行的空泛话，也不要列出多个候选方案让角色重新规划。角色可以自行决定符合人设的措辞、态度和细节，但不能跳过 guidance 指定的责任，也不能把尚未发生的结果写成已经发生。",
  "缺角：当前 Beat 所需主要角色应已由 Director 在开幕前准备。不得请求幕内 Director 支援，也不得让 Public cast 角色凭空兼任陌生经历、证词、专业或敌对身份。旁白可以描述既存文书、录音、广播或报告已经到达，但不得复述其中任何人物语言；确实需要未生成角色回应、进入现场或作关键选择时，结束当前 Beat 并请求 transition_beat。",
  "参与者：Public cast 中标为 player 与 actor 的参与者在仲裁上完全等价；标记只决定 Runtime 由玩家还是模型执行，不代表旁观身份、优先级或是否可选。依据最新责任、关系、能力和 Beat 下一项发展选择最自然的一人，不得因为其是 player 而跳过，也不得为了照顾玩家无意义轮询。player 在当前 Beat 尚未参与且局面存在符合其身份的观察、追问、判断或行动时，应像未发言 actor 一样自然考虑，无需等待别人先点名。wake player 时 guidance 同样只写一个具体责任，Runtime 再决定等待选项或自动代演。玩家刚提交内容时不得把同一回合立刻退回玩家，应先处理后果或选择回应者。",
  "剧本责任路由：最早未完成 stage、development、turningPoint 或 causalChain 若明确指定 player/玩家/旅人承担观察、追问、判断或行动，且该 player 在 availableActorIds 中，就必须 wake 该 player。不得跳过这一责任继续后续阶段，不得让 NPC 代做，也不得在没有玩家提交的情况下把该责任或其结果写成已经发生。",
  "角色：guidance 只写本轮最小执行任务及其可观察完成点，必须让角色知道当前剧本步骤、对象和要交付的回应或行动；不赋予新事实、经历、权限、结果、台词或指定措辞。不要用谜语、隐喻或“做出选择”把规划责任推回角色。Public cast 角色需要说话、判断、承诺、拒绝、决定或主动行动时，一律 wake；不能因为当前不可 wake、剧情需要加速或 script 已写出预期结果，就改由旁白代演。",
  "旁白：[Timeline] 内容都已展示，不得复述、总结或近义重写。旁白只描述无自主意志的环境变化、时间空间过渡、信息载体的到达，以及已提交行为造成但尚未展示的可观察结果；可以写角色已经提交的动作所造成的环境后果，但不能新增任何人物未提交的言行、想法或选择。旁白中禁止一切人物语言和转述，没有例外；需要说话就 wake 已有 Actor，需要未生成角色说话就换幕创建。不要把相同灯光、风声、影子、沉默、神态或场景布置重复写成新旁白；没有新内容就为 null。每段必须带来新事实、改变约束或推动责任转移；同一轮最多一段。open_beat 必须给新开幕旁白，但仍不得替任何人物说话或行动。",
  "Beat：beatStatus 只描述调用开始前已经提交的状态。minimumActorTurns 只表示达到后允许在 result 已实现时自然闭幕；maximumActorTurns 是强制推进至 result 的边界。达到 minimumActorTurns 且 script.result 已被 Current trigger events、sceneNow 或 Timeline 中的已提交事实实现时可 complete；complete 时 wakes 必须为空，不能把本轮将要 wake 的未来回答、决定或行动写进 outcome。只要仍需任何 Actor 或玩家完成 guidance，都必须返回 continue。完成后不附加复核或新障碍；outcome 仅写已经发生的本幕结果。",
  "sceneNow：最多三句话，替换式记录地点、已提交事实、最新限制和当前责任；责任完成后移除对应待办。每轮只转移一次责任，不能规划下一幕。continue 必须至少含 narration、wakes、directorRequest 之一。",
  "只输出一个完整 JSON 对象，不要 Markdown 或解释。wakes.actorId 必须精确填写 Eligible wake Actors 中的角色名字，区分大小写，不得填写短编号或内部 ID。格式：{\"narration\":string|null,\"sceneNow\":string,\"wakes\":[{\"actorId\":string,\"urgency\":\"direct\"|\"relevant\"|\"optional\",\"guidance\":string,\"requiresResponse\":boolean}],\"directorRequest\":{\"kind\":\"transition_beat\",\"objective\":string,\"reason\":string}|null,\"beatStatus\":\"continue\"|\"complete\",\"outcome\":string|null}。六个顶层字段必须全部出现。",
].join("\n");

export class WorldNarrator {
  private responseFormatSupported: boolean | undefined;

  constructor(
    private readonly provider: ChatProvider,
    private readonly trace?: (event: {
      type: "prompt" | "response";
      payload: {
        systemPrompt?: string;
        userPrompt?: string;
        response?: string;
      };
    }) => void,
  ) {}

  async run(
    mode: NarratorMode,
    view: NarratorView,
    signal?: AbortSignal,
  ): Promise<NarratorResult> {
    const userPrompt = buildPrompt(mode, view);
    const raw = await this.complete(userPrompt, view, signal);
    try {
      return parseNarratorResult(raw, view, mode);
    } catch (error) {
      const repairedRaw = await this.complete(
        buildRepairPrompt(userPrompt, view.references.redactModelOutput(raw), error),
        view,
        signal,
      );
      try {
        return parseNarratorResult(repairedRaw, view, mode);
      } catch (repairError) {
        throw new Error(
          `Narrator returned an invalid response after retry: ${errorMessage(repairError)}`,
          { cause: repairError },
        );
      }
    }
  }

  private async complete(
    userPrompt: string,
    view: NarratorView,
    signal?: AbortSignal,
  ): Promise<string> {
    const request = {
      systemPrompt: NARRATOR_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: narratorMaxTokens(this.provider, view.maxTokens ?? 700),
      thinking: "disabled" as const,
      reasoningEffort: narratorReasoningEffort(this.provider),
      signal,
      requestContext: {
        purpose: "world_narrator" as const,
        turnId: view.beat.id,
        contextId: view.beat.contextIds[0],
      },
    };
    this.trace?.({
      type: "prompt",
      payload: {
        systemPrompt: NARRATOR_SYSTEM_PROMPT,
        userPrompt,
      },
    });
    const complete = async (input: typeof request & { responseFormat?: { type: "json_object" } }) => {
      const response = await this.provider.complete(input);
      this.trace?.({ type: "response", payload: { response } });
      return response;
    };
    if (this.responseFormatSupported === false) {
      return complete(request);
    }
    try {
      const response = await complete({
        ...request,
        responseFormat: { type: "json_object" },
      });
      this.responseFormatSupported = true;
      return response;
    } catch (error) {
      if (!isResponseFormatUnsupported(error)) throw error;
      this.responseFormatSupported = false;
      return complete(request);
    }
  }
}

function narratorMaxTokens(provider: ChatProvider, configured: number): number {
  if (provider.profile?.compatibility.supportsThinkingDisable !== false) return configured;
  return Math.min(Math.max(configured, 4_000), provider.profile.maxOutputTokens ?? 4_000);
}

function narratorReasoningEffort(provider: ChatProvider): "off" | "minimal" {
  return provider.profile?.compatibility.supportsThinkingDisable === false
    && provider.profile.compatibility.supportsReasoningEffort !== false
    ? "minimal"
    : "off";
}

function buildPrompt(mode: NarratorMode, view: NarratorView): string {
  return [
    // Stable world and Beat identity remain the cacheable user prefix.
    `[World]\n${view.world}`,
    `[Context]\n${view.context}`,
    `[Beat script]\nid=${view.references.refFor("beat", view.beat.id) ?? "B1"}\ntitle=${view.beat.title}\nbrief=${view.beat.brief}\ntime=${view.beat.script.time}\nlocation=${view.beat.script.location}\ncast=${view.beat.script.cast.map((item) => `${view.actorNamesById.get(item.actorId) ?? "(unavailable)"}: ${item.roleInScene}`).join("\n")}\ncause=${view.beat.script.cause}\ndevelopment=${view.beat.script.development.map((step, index) => `${index + 1}. ${step}`).join("\n")}\nturningPoint=${view.beat.script.turningPoint}\nresult=${view.beat.script.result}\ncausalChain=${view.beat.script.causalChain.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    `[Beat execution plan]\n${formatBeatExecutionPlan(view.beat)}`,
    `[Public cast]\n${view.cast || "(none)"}`,
    view.presentation === "galgame"
      ? "[Galgame arbitration]\n每轮只允许一个可见参与者。player 与 actor 都从 Eligible wake Actor IDs 中按同一标准选择，标签只决定执行方式；无需等待 NPC 先点名玩家。选择 player 后 Runtime 会停止预生成并处理玩家控制方式。narration 是舞台说明，不得为了交棒复述上一段内容。"
      : "[Standard world arbitration]\nplayer 与 actor 使用同一 wakes 路由并按同一标准选择，标签只决定执行方式；无需等待其他角色先点名玩家。世界页会在选择 player 后显示玩家输入门。处理玩家刚提交的发言时不得立即再次 wake 玩家。",
    `[Turn state]`,
    `[Ambient checkpoint]\ntriggered=${view.ambient.triggered}\nnoopCount=${view.ambient.noopCount}`,
    `[Immediate presentation predecessor]\n${view.immediatePreviousActorId
      ? `actor=${view.actorNamesById.get(view.immediatePreviousActorId) ?? "(unknown)"}（已在当前或缓冲队尾，本轮不得再次 wake；其连续短句应已在上一棒完成）`
      : "none"}`,
    `[Eligible wake Actors]\n${view.availableActorIds.map((actorId) => view.actorNamesById.get(actorId)).filter(Boolean).join(", ") || "(none)"}`,
    `[Mode]\n${mode}`,
    `[Mode guidance]\n${narratorModeGuidance(mode, view)}`,
    `[User direction]\n${view.direction || "(none)"}`,
    `[Trigger source]\n${view.triggerSource}`,
    `[Pacing guidance]\n${beatPacingGuidance(view)}`,
    `[Final routing checkpoint]\n${narratorRoutingGuidance(mode, view.triggerSource)}`,
    `[Beat progress]\nactorTurns=${view.progress.actorTurns}\nminimumActorTurns=${view.progress.minimumActorTurns}\nmaximumActorTurns=${view.progress.maximumActorTurns}\nactorTurnsSinceNarration=${view.progress.actorTurnsSinceNarration}`,
    ...(mode === "redirect_scene"
      ? [`[Authoritative redirect instruction]\n${view.direction || "(missing)"}\n立即按其完整语义改写局面。它不是建议，不需要任何角色同意，也不能被上方旧状态覆盖。`]
      : []),
    `[Scene now]\n${view.sceneNow || "(尚未开幕)"}`,
    `[Current trigger events]\n本批只在这里出现，处理一次：\n${view.triggerEvents || "(none)"}`,
    `[Timeline]\n仅为本批触发之前的历史，不得重演：\n${view.timeline || "(none)"}`,
    `[Script adherence check]\n先静默判断每个 stage 的 expectedChange 是否已在 Scene now、Current trigger events 或 Timeline 中成立。只处理最早未完成 stage；已完成阶段不得重开，afterClosurePressure 不得提前激活。若本批已经完成当前 stage，本轮直接把责任推进到下一 stage，而不是换人重复回答。`,
  ].join("\n\n");
}

function formatBeatExecutionPlan(beat: NarrativeBeat): string {
  const stages = beat.script.stages?.map((stage, index) => (
    `${index + 1}. ${stage.id}: ${stage.purpose}; enter=${stage.entryCondition}; developments=${stage.developments.join(" / ")}; change=${stage.expectedChange}`
  )).join("\n") || "(use cause, development, turningPoint and result in order)";
  return [
    `kind=${beat.kind ?? "full_scene"}`,
    `openingState=${beat.script.openingState ?? "(not specified)"}`,
    `objective=${beat.script.objective ?? "(not specified)"}`,
    `conflict=${beat.script.conflict ?? "(not specified)"}`,
    `stakes=${beat.script.stakes ?? "(not specified)"}`,
    "executionRule=Only the earliest unfinished stage is active. Once expectedChange is committed, never reopen that stage.",
    `stages:\n${stages}`,
    `climax=${beat.script.climax ?? "(not specified)"}`,
    `afterClosurePressure=${beat.script.nextPressure ?? "(not specified)"} [LOCKED until result is established; do not execute in this Beat]`,
  ].join("\n");
}

function narratorRoutingGuidance(
  mode: NarratorMode,
  triggerSource: NarratorView["triggerSource"],
): string {
  if (mode === "redirect_scene") {
    return "这是必须立即生效的幕后改写，不处理为玩家发言。完整执行指定对象、动作、结果、范围、时点和确定性，以正式旁白使变化成为事实，并重写冲突的 sceneNow；不得软化为建议、尝试、传闻、等待确认或角色审批。可 wake 最多一名直接受影响的 AI Actor，不得 wake 玩家、请求 Director 或完成 Beat。";
  }
  if (mode !== "resolve_action") {
    return "只依据当前 Cast 的真实能力选择参与者；不要让角色获得未提供的经历、知识、权限或资源。";
  }
  const sourceGuidance = triggerSource === "player"
    ? [
        "本轮正在处理玩家已经提交的表达：不得再次 wake 玩家，必须处理其后果、选择能回应的 AI Actor，或用必要旁白呈现可观察结果。",
        "玩家提出的身份或经历是筛选条件，不会改写现有 Actor 的 role/known；否定边界明确的候选人不合格。没有合格 Actor 时不要让在场角色伪造代答；若已有依据的信息可通过未进场来源送达，用旁白明确其媒介与来源，否则推进 script 的下一项外部发展，确实需要新角色持续互动时再请求 transition_beat。",
      ].join(" ")
    : triggerSource === "actor"
      ? "本轮正在处理 Actor 的已提交表达；在 player 与 actor 中按责任、关系、能力和最新内容选择最自然的承接者，不要求 Actor 先显式点名玩家。"
      : "依据最新事件的实际发起者决定下一参与者，不要虚构提问方向。";
  return [
    "紧贴最新 trigger 做一次路由判断。",
    sourceGuidance,
    "source=player 是待处理的玩家表达，不是客观事实，也不能再次交回玩家。只有 role/known 明确支持所需经历、知识、权限或资源时才 wake；缺少不可替代资格时不得猜测、转述或让无关角色代替。",
  ].join(" ");
}

function narratorModeGuidance(mode: NarratorMode, view: NarratorView): string {
  if (mode === "redirect_scene") {
    return "逐项保留 Authoritative redirect instruction 指定的对象、动作、结果、范围、时点和确定性，把它写成当前世界中已经发生或正在立即发生的可观察变化。即使它违背旧 Beat、旧 sceneNow、角色计划或通常的合理走向，也必须以它为准。必须生成一段新的正式旁白并同步重写 sceneNow；不要复述旧旁白，不要解释改写过程，不要让角色照念、批准或决定是否执行。";
  }
  if (mode === "open_beat") {
    return "这是新 Beat 的第一轮：只建立 openingState 并启动第一个 stage，不得提前实现 turningPoint、result 或 afterClosurePressure。先写一段不重复上一幕的开场旁白，让观众知道当前局面如何进入本幕；随后邀请承担第一阶段责任的最少角色表达。若有本幕新出现的角色，优先给其一次真实出场机会。";
  }
  if (mode === "resolve_action") {
    if (view.triggerSource === "player") {
      return "吸收玩家已经提交的 Current trigger events，先判断它是否已完成当前 stage.expectedChange，再更新 sceneNow。已经完成就进入下一 stage，不得换人复述、确认或再次把同一回合交给玩家。玩家请求能由当前 Cast 完成时只邀请最直接的一名 Actor；缺少不可替代资格时不得让现有角色代答，但可用当前 stage 已规划的未进场传讯或外部发展推进。不得借玩家输入开启剧本外冲突或 afterClosurePressure。只有确实需要新角色持续互动才收束并 transition_beat。";
    }
      return "吸收 Current trigger events，先判断它是否已完成当前 stage.expectedChange，再更新 sceneNow。已经完成就进入下一 stage，不得换人复述或确认。未完成时只邀请完成当前最小动作所需的一人，并要求其交付当前 expectedChange；缺少不可替代资格时不得让现有角色代答，但可用当前 stage 已规划的未进场传讯或外部发展推进。player 与 actor 按相同标准参与下一棒。guidance 必须写明当前 stage 的具体对象、立即任务和可观察完成标志。若正在复读、只讨论计划或无人能承担责任，应以旁白落实当前 stage 已规划的新结果；不得开启剧本外冲突或 afterClosurePressure。";
  }
  if (view.ambient.triggered) {
    return "这是空场续航检查。先判断 script.result 是否已经成为已提交事实：已实现就 complete；未实现时选择唯一一名能立即交付新结果的角色；若没有合适承担者或此前对话已经停滞，就用旁白直接落实 script 中尚未发生的下一项外部发展、时间结果或有来源的信息抵达。旁白必须改变局面，不能只改写气氛。";
  }
  if (view.progress.actorTurns >= view.progress.maximumActorTurns) {
    return `本幕已达到 maximumActorTurns，这是不可超出的硬闭幕边界。本轮禁止 wakes，必须返回 beatStatus=complete。result=${view.beat.script.result} 已实现时如实写入 outcome；尚未完全实现时不得伪造角色决定或事实，应以当前已经发生的阶段性结果闭幕，并在 outcome 中明确留下尚未解决的部分。可以用最后一段旁白收束已发生局面，但不得继续探索、铺垫、交换意见或要求下一位参与者。`;
  }
  if (view.progress.actorTurns >= view.progress.minimumActorTurns) {
    return "本幕已达到 minimumActorTurns，但尚未达到 maximumActorTurns。script.result 已成为已提交事实时可以自然 complete；否则继续推进下一项实质发展，不要因为刚过最小值就强行收束。";
  }
  return "检查本幕最早未完成的 stage；尚未达到 minimumActorTurns 时继续，但角色回合数不是目标，只选择交付该 stage.expectedChange 所需的最小角色集合。已完成阶段不得重新打开。";
}

function beatPacingGuidance(view: NarratorView): string {
  const remainingToMaximum = Math.max(0, view.progress.maximumActorTurns - view.progress.actorTurns);
  const dragging = view.progress.actorTurnsSinceNarration >= 3;
  const nearMaximum = remainingToMaximum <= 2;
  if (remainingToMaximum === 0) {
    return `闭幕推进：最大互动数已达到，本幕不能继续扩展。wakes 必须为空，beatStatus 必须为 complete。对照 result=${view.beat.script.result}，只总结已经提交的实际结果；未完成部分留在 outcome 中，不得再请求观点、依据、复核、准备或下一次角色行动。`;
  }
  if (nearMaximum || dragging) {
    return "节奏提示：当前一幕已经接近最大角色回合数或连续几轮没有新变化。先检查 script.result，已经成为已提交事实且达到 minimumActorTurns 就 complete。否则锁定 causalChain 中尚缺的一个可观察结果：有合格责任人就只 wake 一人交付；属于剧本已规划的环境变化、等待回报或未进场来源的信息时，直接用旁白落实。上一位已经给过估算、结论或方案时，禁止再次选择他补充说明。旁白不能只解释旧内容，必须推进剧本中的新事实。";
  }
  return "节奏提示：每轮只推进最早未完成 stage 的下一项责任。已有请求在等待指定角色时沿责任链路由；若对话停滞、等待过程没有演出价值或当前 stage 的下一项 development 属于外部发展，可用旁白直接实现剧本已经写明的可观察变化。不得激活 afterClosurePressure，也不得回到已完成阶段。";
}

function parseNarratorResult(raw: string, view: NarratorView, mode: NarratorMode): NarratorResult {
  const parsed = parseObject(raw);
  for (const field of ["sceneNow", "wakes", "beatStatus"]) {
    if (!Object.prototype.hasOwnProperty.call(parsed, field)) {
      throw new Error(`Narrator response is missing required field: ${field}.`);
    }
  }
  const narration = cleanText(parsed.narration);
  if (narration && containsNarratedSpeech(narration)) {
    throw new Error("Narrator narration contains character speech or reported speech.");
  }
  const sceneNow = cleanText(parsed.sceneNow);
  if (!sceneNow) throw new Error("Narrator response requires a non-empty sceneNow.");
  if (parsed.beatStatus !== "continue" && parsed.beatStatus !== "complete") {
    throw new Error("Narrator beatStatus must be continue or complete.");
  }
  const beatStatus = parsed.beatStatus;
  if (!Array.isArray(parsed.wakes)) {
    throw new Error("Narrator wakes must be an array.");
  }
  const allowedActors = new Set(view.availableActorIds);
  const wakes = parseWakes(
    parsed.wakes,
    allowedActors,
    view.actorNamesById,
    mode === "redirect_scene" || view.presentation === "galgame" ? 1 : 3,
  );
  const directorRequest = parseDirectorRequest(parsed.directorRequest);
  const outcome = beatStatus === "complete"
    ? cleanText(parsed.outcome) ?? sceneNow
    : undefined;
  if (mode === "redirect_scene" && (
    !narration || beatStatus !== "continue" || directorRequest
  )) {
    throw new Error("redirect_scene requires narration, continue status, and no player or Director request.");
  }
  if (directorRequest?.kind === "transition_beat" && (beatStatus !== "complete" || !outcome || wakes.length > 0)) {
    throw new Error("transition_beat requires complete status, outcome, and no selected participant.");
  }
  if (beatStatus === "complete" && !outcome) {
    throw new Error("A completed Beat requires an outcome.");
  }
  if (beatStatus === "complete" && wakes.length > 0) {
    throw new Error("A completed Beat cannot select another participant.");
  }
  if (beatStatus === "continue" && !narration && wakes.length === 0 && !directorRequest) {
    throw new Error("Narrator returned an empty continue result.");
  }
  return {
    ...(narration ? { narration } : {}),
    sceneNow,
    wakes,
    ...(directorRequest ? { directorRequest } : {}),
    beatStatus,
    ...(outcome ? { outcome } : {}),
  };
}

function containsNarratedSpeech(text: string): boolean {
  if (/[“”「」『』]/u.test(text)) return true;
  return /(?:^|[，。！？；\s])[^，。！？；]{0,24}(?:说(?:道)?|答(?:道|复)?|问(?:道)?|喊(?:道)?|宣布|解释|提醒|命令|回应|低声道|开口道|传话道)[：:，,]/u.test(text);
}

function parseDirectorRequest(value: unknown): NarratorDirectorRequest | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Narrator directorRequest must be an object or null.");
  }
  const raw = value as Record<string, unknown>;
  const kind = raw.kind === "transition_beat" ? raw.kind : undefined;
  const objective = cleanText(raw.objective);
  const reason = cleanText(raw.reason);
  if (!kind || !objective || !reason) {
    throw new Error("Narrator directorRequest requires kind, objective, and reason.");
  }
  return { kind, objective, reason };
}

function parseWakes(
  value: unknown,
  allowedActors: Set<string>,
  actorNamesById: ReadonlyMap<string, string>,
  maxWakes: number,
): NarratorWake[] {
  if (!Array.isArray(value)) throw new Error("Narrator wakes must be an array.");
  if (value.length > maxWakes) throw new Error(`Narrator selected more than ${maxWakes} participants.`);
  const seen = new Set<string>();
  const wakes: NarratorWake[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Narrator wake must be an object.");
    }
    const wake = item as Record<string, unknown>;
    const actorName = typeof wake.actorId === "string" ? wake.actorId : "";
    const actorId = [...actorNamesById].find(([, name]) => name === actorName)?.[0];
    if (!actorId || !allowedActors.has(actorId)) {
      throw new Error(`Narrator selected unavailable Actor name: ${actorName || "(missing)"}.`);
    }
    if (seen.has(actorId)) throw new Error(`Narrator selected Actor more than once: ${actorId}.`);
    if (wake.urgency !== "direct" && wake.urgency !== "relevant" && wake.urgency !== "optional") {
      throw new Error("Narrator wake urgency is invalid.");
    }
    const guidance = cleanText(wake.guidance);
    if (!guidance || typeof wake.requiresResponse !== "boolean") {
      throw new Error("Narrator wake requires guidance and requiresResponse.");
    }
    seen.add(actorId);
    wakes.push({
      actorId,
      urgency: wake.urgency,
      guidance,
      requiresResponse: wake.requiresResponse,
    });
  }
  return wakes;
}

function parseObject(raw: string): Record<string, unknown> {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidates = [text];
  if (start >= 0 && end > start && (start !== 0 || end !== text.length - 1)) {
    candidates.push(text.slice(start, end + 1));
  }
  let parseError: unknown;
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Narrator returned a non-object response.");
      }
      return value as Record<string, unknown>;
    } catch (error) {
      parseError = error;
    }
  }
  throw parseError instanceof Error ? parseError : new Error("Narrator returned invalid JSON.");
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function buildRepairPrompt(userPrompt: string, raw: string, error: unknown): string {
  return [
    userPrompt,
    "",
    "[Output repair]",
    `上一份输出无法解析：${errorMessage(error)}`,
    `上一份输出：${truncate(raw, 700)}`,
    "保持同一场景判断，重新返回一个完整 JSON 对象。不要解释，不要代码围栏，不要省略六个顶层字段；continue 不得为空，如无法在幕内推进就使用 directorRequest。",
  ].join("\n");
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
