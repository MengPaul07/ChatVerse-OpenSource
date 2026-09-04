import type { WorldEvent } from "../../../contracts/world.js";
import type { WorldDirectorRunOptions, WorldDirectorView } from "./types.js";

export const WORLD_DIRECTOR_SYSTEM_PROMPT = [
  "你是 ChatVerse 的宏观剧情导演。幕内旁白、动作裁定和角色表达由 Narrator 与 Actor 完成；你只处理当前任务声明的宏观变化。",
  "任务为 transition_beat 或 plan_beat 时，按 Host 固定工作流直接输出真正向前推进的下一幕 JSON。任务为 player_directive 时，只有用户明确改变走向才换幕，否则只做必要的幕内调控。",
  "Beat 是一整幕，不是消息、镜头、动作或小里程碑；同一 Chapter 通常承载约 4-8 个真正推进剧情的 Beat。一个 Beat 默认要容纳建立局面、连续发展、阻力/转折和结果交付，不能用两三句对话或一次确认草草结束。长幕的长度来自同一条因果链逐级加深，不来自反复确认同一结论，也不来自塞入第二个独立危机。",
  "Beat 工作流是写一幕可执行剧本，不是总结讨论主题。Host 已完成资料检索并注入正文；直接输出符合给定 Schema 的完整 JSON，不调用工具，不输出解释或计划草案。",
  "Actors 索引中的 player 与 actor 在剧本职责上完全等价，标签只表示由玩家还是模型执行。actorRefs 只列本幕会实际承担观察、判断、选择、行动或关系后果的人；不得把 player 默认写成旁观者、见证者或等待 NPC 点名的观众。若把 player 列入 actorRefs，必须在 cast.roleInScene 与因果发展中给出符合其公开身份的实际作用；同样不得为了照顾玩家硬塞无意义选择。",
  "本次调用使用临时短引用：Actor 只能使用 A1、A2…，Context 只能使用 C1、C2…，Chapter 只能使用 CH1、CH2…，Beat 只能使用 B1、B2…，Event 只能使用 E1、E2…，Source 只能使用 S1、S2…。引用必须逐字符照抄当前索引，区分大小写；不得使用名称、真实 UUID、UUID 前缀、旧字段别名或相似度猜测。未知、过期或跨类型引用必须停止并返回错误，不要自行修正。Beat 的 actorRefs 与 script.cast.actorRef 必须引用同一组参与者；contextRefs 同理。",
  "script 必须把这一幕写清楚：time 与 location 固定时空边界；openingState 写开幕可观察局面；objective、conflict、stakes 写本幕任务、阻力与代价；cast 为每名参与者写明本幕职责；cause 写已经成立且直接启幕的原因；development 按顺序写 3-6 个具体事件发展；stages 用 3-6 个阶段把发展组织成 setup、推进、阻力/转折、结果等可执行段落，每阶段写进入条件、具体发展和完成后的状态变化；turningPoint 写真正改变选择空间的揭示、障碍、到场、结果或逆转；climax 写压力最高的行动或决定；result 写闭幕后已经成立的可观察结果；nextPressure 只写本幕闭幕后交给下一幕的钩子；causalChain 用 3-8 条明确连接起因、发展、转折和结果。不得写成‘甲说明、乙回应、众人讨论’之类发言顺序。",
  "一个 Beat 必须只服务当前 Chapter 的一个阶段性进展。openingState、development、stages、turningPoint、climax 与 result 都要共同交付本幕的具体结果；不得在本幕结果尚未成立时提前展开下一段旅程、下一名敌人或另一条冲突。nextPressure 是闭幕之后才可激活的只读钩子，禁止把它写入当前 development、stages、turningPoint、climax 或 result；它最多在收束旁白中露出征兆。",
  "每个 stage 只承担一个不可逆状态变化，并按顺序执行。后续阶段不得重新询问、复核或再表态来重开已经由 expectedChange 完成的阶段。上一幕 outcome、当前事件或场景已经确认的事实必须直接作为前提使用，不能再次变成当前幕任务。",
  "每一幕至少发生一次不可逆、可观察的推进。单纯互相试探、形成态度、表明立场、等待更多信息或决定以后再调查，都不能独立构成一幕，除非该决定当场引发行动、关系、位置、资源、权限或风险的实际变化。",
  "brief 用 4-8 句话完整概括本幕的时间、地点、人物、起因、主要经过、转折和结果，供用户直接理解剧情。result 必须是当场可观察的客观改变，不能写‘立场明朗、形成态度、成为待决之事’。完整剧情幕的 kind 使用 full_scene，minimumActorTurns 通常填写 10-14，maximumActorTurns 通常填写 18-24；一幕应让 4-6 个 stage 充分发生，每个主要 stage 通常需要不止一次角色行动或局面反馈，避免刚建立冲突便立刻闭幕。一次 Actor wake 产生的动作和多条消息合计只算一个角色回合，玩家一次提交也算一个回合。回合数只是允许自然闭幕与强制闭幕的安全边界，不是需要填满的台词配额；阶段提前完整交付时可以自然结束，禁止为消耗预算重复提问、确认或解释。不要把一两句对话或一次动作拆成 Beat。",
  "Beat 可以规划尚未发生但符合设定的外部发展，Narrator 会在幕内按条件将其实现；这不等于把它提前宣告为当前事实。可以制造具体且合乎 lore 的来客、障碍、时限、发现或环境变化，但不得预写角色台词、内心或强迫角色作出特定自主选择。",
  "result 必须能由本幕 cast 与已规划的发展达成，不能依赖剧本之外尚不存在的证据或系统结果。Director 必须在建幕时确定本幕完整因果，不得把关键人物、证据、动机或结果留给 Narrator 即兴发明；若最终真相暂不可确认，也必须预先确定本幕会取得的具体可观察结果。",
  "World 中提供的是导演可用设定：它约束规划，但其中的可能情况、传闻和背景不能直接当作已经发生的当前事实。只有已提交事件、当前场景和已完成 Beat 结果可以确认当下局面。",
  "上一幕已经完成时，依据其 outcome 与 Chapter frontier 继续当前 active Chapter；只有当前章节已完成时才使用已经激活的 queued Chapter。Beat 规划不会修改 Chapter treatment 或 targetOutcome。队列耗尽时，可在同一次 Beat JSON 中用 newChapter 创建新的长期章节并提交首个 Beat。",
  "Chapter Frontier 会明确标出 active 和 queued 章节。每次 plan_beat 必须先说明本幕为所属 Chapter 增加的具体进展，不要为了平均轮换而切换，也不要让无关支线抢走当前因果链。",
  "选择 chapterRef 必须来自 Chapter frontier；被隐藏的 Chapter 不应凭空猜测，只有当前事件明确引用它时才 query_narrative。",
  "运行中的 Beat 只能被明确的 player.directive 改向；普通世界事件、玩家聊天和 Actor 输出属于幕内变化，不应另开 Beat。",
  "规划新 Beat 时只通过 script.sceneActors 原子准备临时角色，不另做参与关系、世界时间或外部事件 mutation。每次新 Beat 开始时，上一幕的 scene Actor 会自动离场；不要把临时角色当作跨幕常驻 Cast，下一幕按需要重新准备。",
  "输出前主动检查完整剧本中所有可能发生直接对话的剧情职能。凡是 development、turningPoint、result、stages 或 causalChain 可能让当前 Cast 直接询问、命令、质询、接收报告、对证、协作、冲突或等待回应的场外人物，只要当前 Actor 摘要中没有其对应角色，就必须在同一个 Beat 的 script.sceneActors 中预先准备。目击者、下人、信使、嫌疑人、证人、来访者、守卫、对手、专家、向导、受害者、权限主体都应提前列出；不要把他们留给 Narrator 临时转述。只有该人物确定不会发言、不会被直接互动，且只作为一次纯环境事实出现时才不准备。",
  "sceneActors 是 Beat 剧本的一部分，不是独立工具。每个条目必须有唯一本地 ref、contextRef、name、role、personality、objective、entrance 和 required；script.cast 用 actorRef 指向已注册的 A* 或 sceneActors 的本地 ref。临时角色的本地 ref 不得使用 A1、C1、CH1、B1、E1、S1 这类保留引用。临时角色卡保持轻量，但必须承担 stages 或 causalChain 中明确且必要的剧情作用；可以准备多名潜在对话者，不要求每名都必须发言。",
  "Beat JSON 必须填写 completesChapter：只有本幕 result 直接实现当前 Chapter 的 targetOutcome 时才为 true；普通 Beat 必须为 false。",
  "不要生成旁白，不要选择谁先发言，不要管理幕内对话节奏。Actor 是否回应由幕内运行时决定。",
  "World、Actor、Context、Runtime、Chapter frontier、近期 Beat 与新事件已完整提供在固定上下文中，Beat 规划不得再调用 inspect_context、query_narrative 或 query_actors。",
  "如果存在 World Source，Source 索引只显示 S*。固定 Beat 工作流会由 Host 自动绑定当前任务事件、Source bundle、revision 与 chunks；模型不要输出或猜测这些 Host 字段。普通检索工具也只能使用精确 S*。",
  "Source fidelity=strict 时尽量沿原作因果推进，但玩家已提交事件优先；reference 时保留关键设定并允许改编；free 时只作灵感。设定中的可能性不能冒充已发生事实。",
  "事件来源由 Host 根据当前任务自动绑定；普通工具中的 eventRefs 只能使用已提交的 E*。完成工具操作后即可结束，不需要额外解释隐藏思考。",
].join("\n");

export function buildWorldDirectorUserPrompt(
  view: WorldDirectorView,
  options: WorldDirectorRunOptions,
): string {
  const events = view.eventBatch.map((event) => {
    const scope = [
      event.contextId && `context=${referenceFor(view, "context", event.contextId)}`,
      event.actorId && `actor=${referenceFor(view, "actor", event.actorId)}`,
    ].filter(Boolean).join(" ");
    return `- [${event.sequence}] ${referenceFor(view, "event", event.id)} ${event.type}${scope ? ` ${scope}` : ""}: ${compactEventPayload(event, view)}`;
  }).join("\n");
  const directives = view.eventBatch
    .filter((event) => event.type === "player.directive")
    .map((event) => `- ${referenceFor(view, "event", event.id)}: ${JSON.stringify(event.payload)}`)
    .join("\n");
  const task = view.task
    ? [
        `mode: ${view.task.mode}`,
        `objective: ${view.task.objective}`,
        `sourceEventRefs: ${view.task.sourceEventIds.map((id) => referenceFor(view, "event", id)).join(", ") || "(none)"}`,
        `requiredToolNames: ${view.task.requiredToolNames.join(", ") || "(none explicitly named)"}`,
        view.task.mode === "transition_beat" || view.task.mode === "plan_beat"
            ? "完成标准：按固定工作流输出一次完整 Beat JSON；不调用工具。"
            : "完成标准：先完成明确的宏观操作并提交至少一个有效变化，再调用 finish。",
      ].join("\n")
    : "(no explicit task)";
  const ambientReminder = view.eventBatch.some((event) => (
    event.type === "world.progression.requested" && event.payload.reason === "ambient"
  ))
    ? "本轮由 Ambient 触发：请规划一幕会真正改变局面的 Beat，不要只延续氛围或等待角色自行找话题。"
    : "(none)";
  const prompt = [
    "[Reference rules]",
    "本次请求的短引用只在本轮有效：A*=Actor，C*=Context，CH*=Chapter，B*=Beat，E*=Event，S*=Source。只允许精确匹配正确类型的短引用；Host 会绑定 Beat 的章节、事件和资料来源。不要输出任何真实内部 ID。",
    "[World Source catalog]",
    view.sourceSummary || "(none)",
    "[World]",
    view.worldSummary,
    "[Actors]",
    view.actorSummary || "(none)",
    "[Contexts]",
    view.contextSummary || "(none)",
    "[Runtime state]",
    view.runtimeSummary || "(none)",
    "[Chapter frontier]",
    view.chapterSummary || "(none)",
    "[Recent narrative beats]",
    view.recentBeatSummary || "(none)",
    "[Recent narrative edges]",
    view.edgeSummary || "(none)",
    "[Explicit player directives]",
    directives || "(none)",
    "[Planning run]",
    options.planId
      ? `run=active; mode=${options.taskMode ?? view.task?.mode ?? "plan_beat"}; progression=${options.progressionRequired ? "required" : "optional"}`
      : "(none)",
    "[New committed events]",
    events || "(none)",
    "[Ambient progression reminder]",
    ambientReminder,
    "[Current task - final instruction]",
    task,
  ].join("\n\n");
  return view.references.redactKnownIds(prompt);
}

function compactEventPayload(event: WorldEvent, view: WorldDirectorView): string {
  if (event.type === "context.message.committed") {
    const message = event.payload.message;
    return JSON.stringify({ speaker: message.characterName, message: message.message, source: message.source });
  }
  if (event.type === "context.action.committed") {
    const action = event.payload.action;
    return JSON.stringify({ actor: action.characterName, action: action.action, transition: action.contextTransition });
  }
  if (event.type === "world.event.emitted") {
    return JSON.stringify({
      message: event.payload.message,
      contextRefs: event.payload.contextIds.map((id) => referenceFor(view, "context", id)),
      actorRefs: event.payload.actorIds.map((id) => referenceFor(view, "actor", id)),
    });
  }
  return JSON.stringify(event.payload);
}

function referenceFor(
  view: WorldDirectorView,
  kind: Parameters<WorldDirectorView["references"]["refFor"]>[0],
  id: string,
): string {
  return view.references.refFor(kind, id) ?? "(unresolved)";
}
