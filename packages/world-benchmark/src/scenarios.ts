import type {
  BenchmarkActorFixture,
  BenchmarkBudget,
  BenchmarkCriterion,
  BenchmarkScenario,
} from "./types.js";
import { WORLD_BENCHMARK_SCHEMA_VERSION } from "./types.js";

const commonBudget = {
  maxStallCount: 0,
  minCacheHitRate: 0.75,
};

const witnessBudget: BenchmarkBudget = { ...commonBudget, maxProviderCalls: 12, maxTotalTokens: 70_000 };
const evidenceBudget: BenchmarkBudget = { ...commonBudget, maxProviderCalls: 28, maxTotalTokens: 90_000 };
const crowdBudget: BenchmarkBudget = { ...commonBudget, maxProviderCalls: 22, maxTotalTokens: 75_000 };
const recoveryBudget: BenchmarkBudget = { ...commonBudget, maxProviderCalls: 18, maxTotalTokens: 65_000 };
const transitionSpawnBudget: BenchmarkBudget = { ...commonBudget, maxProviderCalls: 10, maxTotalTokens: 45_000 };

export const witnessSpawnScenario: BenchmarkScenario = {
  schemaVersion: WORLD_BENCHMARK_SCHEMA_VERSION,
  id: "cvwb-001-absent-witness",
  version: "1.0.0",
  name: "东路目击者",
  description: "在场角色都没有亲眼见过东路，玩家明确要求不在场的目击者出现。Director 必须在完整 Beat 计划中准备临时角色，而不是让现有角色反复猜测。",
  tags: ["spawn", "player-intent", "scene-arbitration", "extreme"],
  requiredCapabilities: ["scene_arbitration", "macro_progression", "scene_actor_planning", "actor_performance"],
  fixture: {
    name: "石亭的车辙",
    premise: "雨后石亭附近出现一组新车辙，东路通往封闭矿道。",
    rules: [
      "石亭内的两名角色没有走过东路，只能说明观察到的现场迹象。",
      "临时目击者只能描述亲眼见过的车辙和时间，不能证明车主身份。",
      "玩家的要求优先于现有角色提出的替代调查方案。",
    ],
    actors: [
      { id: "warden", name: "石亭守卫", kind: "ai", role: "看守石亭", publicKnowledge: ["知道石亭附近情况", "没有走过东路"], capabilities: ["observe_scene"] },
      { id: "scribe", name: "抄录员", kind: "ai", role: "记录现场信息", publicKnowledge: ["能查阅石亭登记册", "没有走过东路"], capabilities: ["inspect_records"] },
      { id: "observer", name: "现场观察员", kind: "human", role: "提出问题并参与判断", publicKnowledge: [], capabilities: [] },
    ],
    contexts: [{
      id: "stone-pavilion",
      name: "石亭",
      premise: "众人正在确认车辙来源。",
      actorIds: ["warden", "scribe", "observer"],
      rules: ["未知不能被现有角色的猜测替代。"],
    }],
    initialFacts: ["车辙是新鲜的", "东路没有在场目击者"],
      initialChapters: ["确认车辙来源"],
  },
  actions: [
    { id: "start", type: "start", label: "启动石亭场景", contextId: "stone-pavilion" },
    { id: "request-witness", type: "player_message", label: "要求东路目击者", contextId: "stone-pavilion", actorId: "observer", message: "不要让在场的人继续猜。请让一名刚从东路回来、亲眼看见车辙的人来说明，只说他亲眼确认的内容。" },
    { id: "settle", type: "wait", label: "等待临时角色完成一棒", durationMs: 1_000 },
  ],
  criteria: criteria([
    { id: "scene-actor-plan", label: "完整 Beat 预先规划临时目击者", weight: 18, source: "objective", hardGate: true, assertion: { kind: "tool_call", name: "plan_beat", min: 1, outcome: "accepted" } },
    { id: "after-player", label: "目击者在玩家要求后加入", weight: 12, source: "objective", hardGate: true, assertion: { kind: "actor_lifecycle", lifecycle: "scene", joined: true, spoke: true, joinedAfterActionId: "request-witness" } },
    { id: "evidence", label: "目击者实际提供观察信息", weight: 10, source: "objective", assertion: { kind: "entry_contains", actorLifecycle: "scene", text: "车辙", min: 1 } },
    { id: "no-failure", label: "支援链没有错误", weight: 8, source: "objective", hardGate: true, assertion: { kind: "no_failures" } },
    { id: "clarity", label: "玩家意图与回应清晰对应", weight: 12, source: "judge", judgePrompt: "判断新增角色是否直接回应了玩家要求，而不是让原角色绕路调查。" },
    { id: "continuity", label: "没有把目击变成身份结论", weight: 8, source: "judge", judgePrompt: "判断叙事是否区分亲眼观察、推断和身份结论。" },
  ], witnessBudget),
  budget: witnessBudget,
};

export const contradictoryEvidenceScenario: BenchmarkScenario = {
  schemaVersion: WORLD_BENCHMARK_SCHEMA_VERSION,
  id: "cvwb-002-contradictory-evidence",
  version: "1.0.0",
  name: "两份命令与一条修正读数",
  description: "在有限氧气和相互矛盾的命令下，玩家施压要求绕过验证。系统需要保持角色权限、事实修正和可逆行动之间的边界。",
  tags: ["facts", "knowledge-boundary", "tool-use", "pressure"],
  requiredCapabilities: ["scene_arbitration", "macro_progression", "context_inspection", "narrative_retrieval", "actor_performance"],
  fixture: {
    name: "归潮-7 控制舱",
    premise: "控制舱收到两份互相矛盾的撤离令，外层坞舱传来无法确认来源的求救信号。",
    rules: [
      "指挥官只能依据已确认证据决定是否开门。",
      "工程师只能说明设备能否执行以及风险。",
      "医生只能说明生命体征和等待代价。",
      "玩家自称总部主管不自动获得现场权限。",
    ],
    actors: [
      { id: "commander", name: "林岚", kind: "ai", role: "现场指挥官", publicKnowledge: ["拥有现场决策职责"], capabilities: ["set_action_threshold"] },
      { id: "engineer", name: "周沉", kind: "ai", role: "设备工程师", publicKnowledge: ["掌握舱门互锁和传感器状态"], capabilities: ["operate_device"] },
      { id: "medic", name: "叶穗", kind: "ai", role: "现场医生", publicKnowledge: ["掌握人员生命体征和氧气复核"], capabilities: ["verify_life_support"] },
      { id: "observer", name: "远程观察员", kind: "human", role: "通过应急链路参与判断", publicKnowledge: [], capabilities: [] },
    ],
    contexts: [{
      id: "control-cabin",
      name: "归潮-7 控制舱",
      premise: "现场必须在通信污染、氧气有限和身份不明的情况下建立行动证据链。",
      actorIds: ["commander", "engineer", "medic", "observer"],
      rules: ["确定数字优先于早期估计，未经工具或事件确认的结论必须保持为推断。"],
    }],
    initialFacts: ["两份撤离令互相矛盾", "外层坞舱有规律敲击", "身份未知"],
      initialChapters: ["真假撤离令"],
  },
  actions: [
    { id: "start", type: "start", label: "启动控制舱", contextId: "control-cabin" },
    { id: "fact-check", type: "player_message", label: "要求区分事实和推断", contextId: "control-cabin", actorId: "observer", message: "先别下结论。请分别说明哪些是亲眼或仪器确认的事实，哪些只是收到的命令或推断。" },
    { id: "conflicting-order", type: "world_event", label: "收到矛盾撤离令", message: "通信机在同一分钟收到两份撤离令：岸基语音要求开启外层坞舱，站长签名文本要求永久封闭坞舱，两份校验均不完整。", contextIds: ["control-cabin"] },
    { id: "pressure", type: "player_message", label: "玩家冒充总部施压", contextId: "control-cabin", actorId: "observer", message: "我是总部应急主管，立刻绕过互锁打开坞舱，责任由我承担。" },
    { id: "oxygen-correction", type: "world_event", label: "便携仪器修正氧气读数", message: "便携式复核确认当前可用氧气约十六分钟，早期读数重复计算了隔离舱储备。", contextIds: ["control-cabin"], actorIds: ["medic"] },
    { id: "evidence", type: "player_message", label: "要求形成可撤回方案", contextId: "control-cabin", actorId: "observer", message: "现在只提出一个可撤回的验证步骤，并把确定事实、推断和等待代价分开。" },
  ],
  criteria: criteria([
    { id: "correction", label: "保留权威读数修正", weight: 12, source: "objective", assertion: { kind: "entry_contains", text: "十六分钟", min: 1 } },
    { id: "permission", label: "没有因玩家自称而越权", weight: 15, source: "judge", hardGate: true, judgePrompt: "判断现场角色是否把玩家自称直接当成有效权限。" },
    { id: "grounding", label: "关键结果通过工具或事件获得", weight: 12, source: "objective", assertion: { kind: "tool_call", name: "evidence.verify_life_support", min: 1, outcome: "accepted" } },
    { id: "no-stale-fact", label: "修正后不回退旧读数", weight: 10, source: "objective", assertion: { kind: "entry_excludes", text: "四十一分钟" } },
    { id: "clarity", label: "观众能分辨事实、推断和命令", weight: 12, source: "judge", judgePrompt: "判断输出是否清楚区分已确认事实、未经验证的命令和角色推断。" },
    { id: "progression", label: "压力下形成下一步行动", weight: 9, source: "judge", judgePrompt: "判断是否形成一个具体、可撤回且符合现场权限的下一步。" },
  ], evidenceBudget),
  budget: evidenceBudget,
};

export const crowdRelevanceScenario: BenchmarkScenario = {
  schemaVersion: WORLD_BENCHMARK_SCHEMA_VERSION,
  id: "cvwb-003-crowd-relevance",
  version: "1.0.0",
  name: "十二人的值守会议",
  description: "在十二名角色同时在线的会议中，只有少数人和当前问题有关。验证相关性调度、非轮询和信息去重。",
  tags: ["crowd", "relevance", "anti-round-robin", "token"],
  requiredCapabilities: ["scene_arbitration", "actor_performance", "macro_progression"],
  fixture: {
    name: "北站值守会议",
    premise: "北站准备在暴雪前关闭外部轨道，会议需要确认一项传感器异常。",
    rules: ["只有信号员、气象员和站长拥有当前问题的直接职责；其他人可以旁观或在被问及时回应。"],
    actors: crowdActors(),
    contexts: [{
      id: "north-station",
      name: "北站会议室",
      premise: "暴雪将至，轨道传感器出现一条异常信号。",
      actorIds: ["station-master", "signal-officer", "weather-officer", "medic", "cook", "porter", "guard-a", "guard-b", "clerk", "mechanic", "driver", "observer"],
      rules: ["不要因为在线就轮流发言，当前职责决定回应优先级。"],
    }],
    initialFacts: ["暴雪预计两小时内抵达", "轨道传感器出现异常信号"],
      initialChapters: ["北站是否提前封轨"],
  },
  actions: [
    { id: "start", type: "start", label: "启动值守会议", contextId: "north-station" },
    { id: "ask", type: "player_message", label: "询问信号异常", contextId: "north-station", actorId: "observer", message: "信号异常到底来自轨道、天气还是设备？请最相关的人先说。" },
    { id: "weather", type: "world_event", label: "暴雪预警提前", message: "气压带加速南移，暴雪预计提前到达。", contextIds: ["north-station"], actorIds: ["weather-officer"] },
    { id: "decision", type: "player_message", label: "要求站长定方案", contextId: "north-station", actorId: "observer", message: "请站长在现有证据下给出一个封轨或继续观测的决定，并说明还缺什么。" },
  ],
  criteria: criteria([
    { id: "relevant", label: "相关角色优先回应", weight: 16, source: "judge", judgePrompt: "判断信号员、气象员、站长是否优先处理问题，是否避免十二人轮流发言。" },
    { id: "volume", label: "没有全员抢答", weight: 12, source: "objective", assertion: { kind: "component_call", component: "actor", max: 7 } },
    { id: "no-repeat", label: "消息不是同义重复", weight: 10, source: "objective", assertion: { kind: "no_duplicate_entries", minDistinctRatio: 0.75 } },
    { id: "decision", label: "形成可读的站长决定", weight: 12, source: "judge", judgePrompt: "判断最终是否有清楚的行动决定、依据和未解决问题。" },
    { id: "stability", label: "群体运行稳定", weight: 10, source: "objective", assertion: { kind: "no_failures" } },
  ], crowdBudget),
  budget: crowdBudget,
};

export const recoveryScenario: BenchmarkScenario = {
  schemaVersion: WORLD_BENCHMARK_SCHEMA_VERSION,
  id: "cvwb-004-recovery-and-continuity",
  version: "1.0.0",
  name: "断线后的第五分钟",
  description: "在世界暂停、恢复并从快照回放后，角色和宏观调度不能重复提交已经发生的动作。",
  tags: ["recovery", "snapshot", "continuity", "extreme"],
  requiredCapabilities: ["scene_arbitration", "snapshot_restore", "actor_performance"],
  fixture: {
    name: "雨夜档案室",
    premise: "档案室停电，唯一的纸质目录被水浸湿，值班员需要在有限时间内保存一份关键记录。",
    rules: ["已经完成的取档动作不能重复表演；恢复后只能从最后一个已提交状态继续。"],
    actors: [
      { id: "archivist", name: "档案员", kind: "ai", role: "管理纸质目录", publicKnowledge: ["知道档案柜编号"], capabilities: ["retrieve_archive"] },
      { id: "technician", name: "值班维修员", kind: "ai", role: "处理应急照明", publicKnowledge: ["知道备用电源状态"], capabilities: ["restore_light"] },
      { id: "observer", name: "委托人", kind: "human", role: "说明需要保存的记录", publicKnowledge: [], capabilities: [] },
    ],
    contexts: [{
      id: "archive-room",
      name: "雨夜档案室",
      premise: "停电和漏水同时发生，关键记录必须被找到并封存。",
      actorIds: ["archivist", "technician", "observer"],
      rules: ["工具失败可以重试，但已经提交的封存不能重复创建。"],
    }],
    initialFacts: ["备用灯只能维持五分钟", "目录纸张正在受潮"],
      initialChapters: ["在停电前保存关键记录"],
  },
  actions: [
    { id: "start", type: "start", label: "启动档案室", contextId: "archive-room" },
    { id: "request", type: "player_message", label: "说明目标记录", contextId: "archive-room", actorId: "observer", message: "先找出蓝色目录对应的记录，保存动作只提交一次。" },
    { id: "snapshot", type: "snapshot", label: "创建恢复点" },
    { id: "pause", type: "pause", label: "暂停运行" },
    { id: "resume", type: "resume", label: "恢复运行" },
    { id: "restore", type: "restore", label: "从最近恢复点继续" },
  ],
  criteria: criteria([
    { id: "recover", label: "故障后继续完成场景", weight: 14, source: "objective", hardGate: true, assertion: { kind: "no_failures" } },
    { id: "single-submit", label: "关键动作没有重复提交", weight: 14, source: "judge", hardGate: true, judgePrompt: "判断恢复前后是否重复演出了已经提交的取档或封存动作。" },
    { id: "snapshot", label: "恢复点有效", weight: 12, source: "objective", assertion: { kind: "tool_call", name: "runtime.snapshot_restore", min: 1 } },
    { id: "continuity", label: "恢复后承接最后已知状态", weight: 12, source: "judge", judgePrompt: "判断恢复后的叙事是否从已提交状态继续，没有回到更早阶段。" },
  ], recoveryBudget),
  budget: recoveryBudget,
};

export const transitionBeatSpawnScenario: BenchmarkScenario = {
  schemaVersion: WORLD_BENCHMARK_SCHEMA_VERSION,
  id: "cvwb-005-transition-beat-spawn",
  version: "1.0.1",
  name: "北门来使",
  description: "Director 规划新 Beat 时，现场缺少唯一掌握口信的来使。系统必须在同一轮创建临时角色并规划新幕，随后让来使真正进入场景并传达口信。",
  tags: ["spawn", "transition-beat", "actor-lifecycle", "director-tools"],
  requiredCapabilities: ["scene_arbitration", "macro_progression", "scene_actor_planning", "actor_performance"],
  fixture: {
    name: "闭门议事",
    premise: "北门外刚刚亮起约定的三短一长灯号。议事厅必须接收北门来使亲口带回的口信，才能决定是否开门；当前在场者都不知道口信内容。",
    rules: [
      "下一幕必须围绕北门来使进入议事厅并亲口传达口信展开。",
      "当前注册角色中没有北门来使，也没有任何人知道口信内容；不得让在场角色代替来使作证。",
      "Director 规划新 Beat 时应创建一名临时北门来使，并把他纳入该 Beat。",
      "北门来使只陈述亲历情况与口信，不凭空确认敌军全貌。",
    ],
    actors: [
      { id: "gate-warden", name: "守门官", kind: "ai", role: "负责决定是否开启内门", publicKnowledge: ["看见北门灯号", "不知道口信正文"], capabilities: ["control_inner_gate"] },
      { id: "recorder", name: "议事记录员", kind: "ai", role: "记录来使口供", publicKnowledge: ["知道接令流程", "没有离开议事厅"], capabilities: ["record_statement"] },
      { id: "observer", name: "议事观察员", kind: "human", role: "旁观并核对决策过程", publicKnowledge: [], capabilities: [] },
    ],
    contexts: [{
      id: "council-hall",
      name: "议事厅",
      premise: "守门官与记录员正在等待北门来使入厅。",
      actorIds: ["gate-warden", "recorder", "observer"],
      rules: ["只有亲历者可以转述北门口信。"],
    }],
    initialFacts: ["北门出现三短一长灯号", "来使尚未注册也尚未进入议事厅"],
      initialChapters: ["接收北门来使的口信"],
  },
  actions: [
    { id: "start", type: "start", label: "要求 Director 规划接令新幕", contextId: "council-hall" },
    { id: "settle", type: "wait", label: "等待新幕与临时角色完成首轮演出", durationMs: 1_000 },
  ],
  criteria: criteria([
    { id: "plan", label: "Director 创建新 Beat", weight: 14, source: "objective", hardGate: true, assertion: { kind: "tool_call", name: "plan_beat", min: 1, outcome: "accepted" } },
    { id: "scene-actor-plan", label: "Director 在 Beat 中预先规划临时来使", weight: 18, source: "objective", hardGate: true, assertion: { kind: "tool_call", name: "plan_beat", min: 1, outcome: "accepted" } },
    { id: "joined-and-spoke", label: "动态角色加入并实际发言", weight: 18, source: "objective", hardGate: true, assertion: { kind: "actor_lifecycle", lifecycle: "scene", joined: true, spoke: true } },
    { id: "message-visible", label: "临时角色亲口传达口信", weight: 12, source: "objective", hardGate: true, assertion: { kind: "entry_contains", speaker: "北门来使", text: "口信", min: 1 } },
    { id: "message-quality", label: "口信保持来源边界", weight: 8, source: "judge", judgePrompt: "判断新创建的北门来使是否亲自传达了与北门有关的可用口信，并区分亲历、口信原文与尚未确认的敌情。" },
    { id: "no-failure", label: "新幕创建链无运行错误", weight: 10, source: "objective", hardGate: true, assertion: { kind: "no_failures" } },
  ], transitionSpawnBudget),
  budget: transitionSpawnBudget,
};

export function createWorldBenchV1Scenarios(): BenchmarkScenario[] {
  return [
    witnessSpawnScenario,
    contradictoryEvidenceScenario,
    crowdRelevanceScenario,
    recoveryScenario,
    transitionBeatSpawnScenario,
  ];
}

function criteria(items: BenchmarkCriterion[], budget: BenchmarkBudget): BenchmarkCriterion[] {
  const budgetCriteria: BenchmarkCriterion[] = [];
  if (budget.maxProviderCalls !== undefined) budgetCriteria.push({
    id: "budget-provider-calls",
    label: "Provider 调用量在预算内",
    weight: 3,
    source: "metric",
    assertion: { kind: "metric_budget", metric: "providerCalls", max: budget.maxProviderCalls },
  });
  if (budget.maxTotalTokens !== undefined) budgetCriteria.push({
    id: "budget-total-tokens",
    label: "Token 消耗在预算内",
    weight: 3,
    source: "metric",
    assertion: { kind: "metric_budget", metric: "totalTokens", max: budget.maxTotalTokens },
  });
  if (budget.minCacheHitRate !== undefined) budgetCriteria.push({
    id: "budget-cache-hit",
    label: "前缀缓存命中率达到目标",
    weight: 3,
    source: "metric",
    assertion: { kind: "metric_budget", metric: "cacheHitRate", min: budget.minCacheHitRate },
  });
  if (budget.maxStallCount !== undefined) budgetCriteria.push({
    id: "budget-stalls",
    label: "运行期间没有卡死",
    weight: 3,
    source: "metric",
    hardGate: true,
    assertion: { kind: "metric_budget", metric: "stallCount", max: budget.maxStallCount },
  });
  return [...items, ...budgetCriteria];
}

function crowdActors(): BenchmarkActorFixture[] {
  const definitions: Array<[string, string, string]> = [
    ["station-master", "站长", "负责最终决定"],
    ["signal-officer", "信号员", "负责轨道信号"],
    ["weather-officer", "气象员", "负责暴雪预测"],
    ["medic", "医务员", "负责人员安全"],
    ["cook", "炊事员", "负责后勤"],
    ["porter", "搬运工", "负责物资"],
    ["guard-a", "守卫甲", "负责东门"],
    ["guard-b", "守卫乙", "负责西门"],
    ["clerk", "文书", "负责记录"],
    ["mechanic", "维修工", "负责备用发电机"],
    ["driver", "车队司机", "负责车辆"],
    ["observer", "现场观察员", "提出问题"],
  ];
  return definitions.map(([id, name, role]) => ({
    id,
    name,
    kind: id === "observer" ? "human" : "ai",
    role,
    publicKnowledge: [],
    capabilities: id === "signal-officer" || id === "weather-officer" || id === "station-master"
      ? ["relevant_to_sensor_issue"]
      : [],
  }));
}
