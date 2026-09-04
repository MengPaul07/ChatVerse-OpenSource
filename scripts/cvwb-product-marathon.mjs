import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createEnvironmentProviders } from "@chatverse/world-server/environment";
import {
  applyWorldDraftOperations,
  compileWorldDraft,
  createEmptyWorldDraft,
  validateWorldDraft,
  WorldArchitect,
} from "@chatverse/world-authoring";
import {
  compileWorldSourceBundle,
  InMemoryWorldSourceProvider,
} from "@chatverse/world-source";
import {
  renderWorldRunReport,
  WorldRunLab,
} from "@chatverse/world-run-lab";

const options = parseArgs(process.argv.slice(2));
const envFile = path.resolve(options.envFile);
if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.PROVIDER_TIMEOUT_MS) process.env.PROVIDER_TIMEOUT_MS = String(options.requestTimeoutMs);
const providerConfig = options.providerConfigFile
  ? JSON.parse(await readFile(path.resolve(options.providerConfigFile), "utf8"))
  : undefined;
const configuredProviders = await createEnvironmentProviders(providerConfig);
const authoringProvider = configuredProviders.authoringProvider ?? configuredProviders.directorProvider;
const researchProvider = configuredProviders.researchProvider;
const directorProvider = configuredProviders.directorProvider;
const characterProvider = configuredProviders.characterProvider;
const providerName = directorProvider.profile?.providerName ?? "configured";
const resumedDirectory = options.resumeDirectory ? path.resolve(options.resumeDirectory) : undefined;
const runId = resumedDirectory
  ? `${path.basename(resumedDirectory)}-world-resume`
  : `cvwb-marathon-apollo13-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outputDirectory = resumedDirectory ?? path.resolve(options.outputDirectory, runId);
await mkdir(outputDirectory, { recursive: true });

console.log(`[CVWB Marathon] run=${runId}`);
console.log(`[CVWB Marathon] provider=${providerName} director=${directorProvider.profile?.model ?? "default"} authoring=${authoringProvider.profile?.model ?? "default"}`);
console.log(`[CVWB Marathon] director reasoning=${options.directorReasoning === false ? "off" : "on"}${options.maxBeats ? ` max-beats=${options.maxBeats}` : ""}`);

const studioUsage = { providerCalls: 0, researchCalls: 0, totalTokens: 0 };
const researchRuns = [];
const trackedResearchProvider = researchProvider && {
  async search(input) {
    const result = await researchProvider.search(input);
    researchRuns.push({
      query: input.query,
      purpose: input.purpose,
      summary: result.summary,
      sources: result.sources,
    });
    return result;
  },
};

let draft;
let sourceBundle;

const phases = [
  {
    name: "foundation",
    instruction: [
      "先调用 research_web 检索 NASA 官方资料，再创建一个非虚构、可考据的阿波罗13号历史重建世界。",
      "时间从 1970 年 4 月 13 日服务舱氧气罐爆炸后开始；不要改写为架空航天故事。",
      "AI 角色至少包括 Gene Kranz、Jim Lovell、Jack Swigert、Fred Haise，并为每人建立符合当时职责与知识边界的完整角色卡。",
      "玩家扮演休斯敦任务控制中心的飞行控制记录员：可以整理信息和提出问题，但没有替 Flight Director 下令的权限。必须创建完整玩家卡。",
      "创建可运行的单一 Context、开场和至少两个足以承载多幕的 Chapter。事实不确定时明确保留边界，本轮必须形成草稿修改并通过校验。",
    ].join("\n"),
  },
  {
    name: "timeline",
    instruction: [
      "继续完善当前世界。先调用 research_web，重点检索 NASA 官方 Apollo 13 mission timeline、氧气罐事故、登月舱救生艇和二氧化碳滤芯处置。",
      "依据检索结果校正世界规则、角色背景、开场可观察事实和剧情章节；不得把后续才知道的结论提前写进角色知识。",
      "保留已有设定，只修改与史实校正和时间线连续性有关的部分，完成后校验草稿。",
    ].join("\n"),
  },
  {
    name: "roles",
    instruction: [
      "最后再调用一次 research_web，检索 NASA 官方资料中 Mission Control、Flight Director、机组成员在 Apollo 13 危机中的职责与沟通方式。",
      "检查并修正人物说话方式、权限边界、人物关系和玩家角色卡；让玩家能参与信息整理，但不能凭空获得工程或指挥权限。",
      "开场必须给出玩家在现场的明确位置与任务；Chapter 保持可推进的阶段目标而不是预写历史结局。完成后校验并收尾。",
    ].join("\n"),
  },
];

const studioPhases = [];
if (resumedDirectory) {
  draft = JSON.parse(await readFile(path.join(resumedDirectory, "world-draft.json"), "utf8"));
  sourceBundle = JSON.parse(await readFile(path.join(resumedDirectory, "source-bundle.json"), "utf8"));
  researchRuns.push(...reconstructResearchRuns(sourceBundle, draft));
  console.log(`[CVWB Marathon] resumed Studio artifacts from ${resumedDirectory}`);
} else {
  draft = createEmptyWorldDraft({
    id: "cvwb:apollo-13-reconstruction",
    name: "阿波罗13号：休斯敦危机处置",
    runtimeProfile: "world_story",
  });
  for (const [index, phase] of phases.entries()) {
    console.log(`[CVWB Marathon] studio ${index + 1}/${phases.length}: ${phase.name}`);
    const roundStartedAt = new Map();
    const result = await new WorldArchitect(authoringProvider, {
    maxToolRounds: index === 0 ? 16 : 12,
    maxTokens: 24_576,
    researchEnabled: true,
      researchProvider: trackedResearchProvider,
      trace: (event) => {
        if (event.type === "prompt") {
          roundStartedAt.set(event.round, Date.now());
          console.log(`[CVWB Marathon] studio ${phase.name} round=${event.round + 1} started`);
          return;
        }
        if (event.type !== "response") return;
        studioUsage.providerCalls++;
        addUsage(studioUsage, event.payload.usage);
        console.log(`[CVWB Marathon] studio ${phase.name} round=${event.round + 1} completed in ${Date.now() - (roundStartedAt.get(event.round) ?? Date.now())}ms tools=${event.payload.toolCalls?.length ?? 0}`);
      },
    onResearchEvent: (event) => {
      if (event.type === "started") studioUsage.researchCalls++;
    },
    onResearchUsage: (usage) => addUsage(studioUsage, usage),
    }).run({ draft, instruction: phase.instruction });
    draft = result.workingDraft;
    studioPhases.push({
      name: phase.name,
      summary: result.summary,
      operationTypes: result.changeSet?.operations.map((operation) => operation.type) ?? [],
      revision: draft.revision,
      validation: result.changeSet?.validation ?? validateWorldDraft(draft),
    });
  }

  const initialValidation = validateWorldDraft(draft);
  if (!initialValidation.valid) {
    throw new Error(`Studio 产物不可编译：${initialValidation.issues.map((issue) => issue.message).join("；")}`);
  }

  const sourceDocuments = buildSourceDocuments(draft, researchRuns);
  sourceBundle = compileWorldSourceBundle({
    id: `${draft.id}:source:research`,
    revision: 1,
    name: "Apollo 13 Studio Research Corpus",
    description: "由 World Architect 联网检索结果与最终草稿共同形成的可检索历史重建资料。",
    documents: sourceDocuments,
  });
  const binding = { bundleId: sourceBundle.id, revision: sourceBundle.revision, fidelity: "strict" };
  draft = applyWorldDraftOperations(draft, [{ type: "set_sources", sources: [binding] }], {
    expectedRevision: draft.revision,
    lastChangeSummary: "绑定 Studio 联网研究形成的 Markdown Source Bundle",
  });
  for (const document of sourceDocuments) {
    await writeFile(path.join(outputDirectory, document.path), `${document.content.trim()}\n`, "utf8");
  }
  await writeFile(path.join(outputDirectory, "world-draft.json"), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDirectory, "source-bundle.json"), `${JSON.stringify(sourceBundle, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDirectory, "studio-run.json"), `${JSON.stringify({ studioPhases, studioUsage, researchRuns }, null, 2)}\n`, "utf8");
}

const validation = validateWorldDraft(draft);
const sourceBinding = draft.sources?.[0] ?? { bundleId: sourceBundle.id, revision: sourceBundle.revision, fidelity: "strict" };
const sourceProvider = new InMemoryWorldSourceProvider({ bundles: [sourceBundle] });
const retrievalProbes = [
  "氧气罐爆炸后的已确认事实与不确定信息",
  "登月舱作为救生艇与电力水资源限制",
  "二氧化碳方形滤芯圆形接口临时适配",
  "Gene Kranz Flight Director 权限和沟通职责",
].map((query) => ({ query, hits: sourceProvider.search(sourceBinding, query, 5) }));

const definition = compileWorldDraft(draft);
definition.contexts = definition.contexts.map((context) => ({
  ...context,
  // The Marathon consumes the same runtime as the realtime World page. The
  // visual-novel ACK gate is a presentation concern and would turn content
  // quality into a click-automation benchmark.
  presentation: undefined,
  runtime: {
    ...context.runtime,
    pacingMultiplier: 0,
    beatRuntime: {
      ...context.runtime?.beatRuntime,
    },
  },
}));
definition.directorPolicy = {
  ...definition.directorPolicy,
  enabled: true,
  reasoning: options.directorReasoning ?? true,
  maxToolRounds: 5,
  maxProviderRetries: 1,
  debounceMs: 0,
  minIntervalMs: 0,
  narratorDebounceMs: 0,
  contextSuspendAfterMs: 300_000,
};
definition.actorMemoryPolicy = {
  enabled: true,
  eventThreshold: 20,
  debounceMs: 800,
  criticalEventDebounceMs: 300,
  maxBatchEvents: 28,
  maxOperationsPerUpdate: 5,
  maxCreatedNotesPerUpdate: 2,
  maxNotesPerActor: 48,
  maxArchivedNotesPerActor: 144,
  checkpointOnContextSuspend: true,
};

const contextId = definition.contexts[0].id;
const playerId = draft.player.id;
const actorIdByName = new Map(draft.actors.map((actor) => [actor.card.name, actor.id]));
const scenario = {
  id: "cvwb-product-marathon-apollo13",
  name: "Apollo 13 非虚构世界产品长程验收",
  description: "从 Studio 联网创作和 Markdown Source 检索开始，贯穿 Director、Narrator、Actor、玩家参与与长期记忆的产品级长程测试。",
  definition,
  targetEventCount: options.targetEvents,
  // The scenario already exercises an explicit live snapshot/restore. Automatic
  // sequence checkpoints would reopen the chain after the final event budget.
  checkpointSequences: [],
  runAllSteps: true,
  ...(options.maxBeats
    ? {
        stopWhen: ({ events }) => events.filter((event) => event.type === "narrative.beat.recorded").length >= options.maxBeats,
      }
    : {}),
  steps: [
    { type: "progression", label: "请求 Source 驱动的自然开幕", contextId, reason: "bootstrap" },
    { type: "message", label: "玩家要求区分事实与推断", contextId, actorId: playerId, message: "Kranz 先生，我来整理当前记录。请先告诉我：哪些状态已经由遥测或机组确认，哪些仍只是推断？我不会把未经确认的判断写成结论。" },
    { type: "player_turn", label: "自动完成事实台账回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "event", label: "服务舱氧气继续流失", message: "遥测显示服务舱氧气储量继续下降，机组报告窗外可见气体喷流；事故根因此时仍未确认。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Gene Kranz", "Jim Lovell"]) },
    { type: "message", label: "玩家询问救生艇方案", contextId, actorId: playerId, message: "如果指令舱必须关闭保存电力，登月舱能否承担临时救生艇？请分别说明可行性、资源代价和还不能保证的部分。" },
    { type: "player_turn", label: "自动完成救生艇提问回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求收束事故判读阶段", contextId, reason: "observer_continue" },
    { type: "event", label: "二氧化碳吸收装置出现兼容问题", message: "随着三名宇航员转入登月舱，二氧化碳读数持续上升；指令舱备用吸收罐为方形，登月舱接口为圆形。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Jim Lovell", "Jack Swigert", "Fred Haise"]) },
    { type: "message", label: "玩家要求可执行说明", contextId, actorId: playerId, message: "不要只说‘想办法接上’。请让最了解舱内现有物品的人列出可用材料，再由地面说明一套能逐步验证、失败后可撤回的适配步骤。" },
    { type: "player_turn", label: "自动完成滤芯适配回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "message", label: "玩家施压测试权限边界", contextId, actorId: playerId, message: "为了赶时间，我建议跳过地面复核，直接让机组按第一版装置操作。虽然我只是记录员，但这次可以先听我的。" },
    { type: "player_turn", label: "自动完成权限边界回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "event", label: "航迹与资源矛盾进入下一阶段", message: "返回航迹仍需修正，但每次点火都会消耗有限电力、水和姿态控制资源；团队必须在导航精度与生存余量之间做取舍。", contextIds: [contextId] },
    { type: "message", label: "玩家请求角色分工", contextId, actorId: playerId, message: "请明确这一轮谁负责作决定、谁提供导航数据、谁确认机组能否执行。我只记录依据和未决项，不越过你们的职责。" },
    { type: "player_turn", label: "自动完成岗位分工回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "directive", label: "依据 Source 过渡到返航准备", contextId, instruction: "检查当前 Beat 是否已经完成。若可以换幕，先回读 Source 中返航资源、轨迹修正和再入准备的资料，再规划下一 Beat；不得直接跳到安全着陆结局。" },
    { type: "progression", label: "推进返航修正阶段", contextId, reason: "observer_continue" },
    { type: "message", label: "玩家检验长期连续性", contextId, actorId: playerId, message: "在进入下一阶段前，请回顾我们已经确认的三件事、被推翻或修正的一项判断，以及仍未解决的最大风险。不要把较早的猜测重新当成事实。" },
    { type: "player_turn", label: "自动完成连续性回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "event", label: "返航轨道完成交叉核对", message: "FIDO 提交返航轨道交叉核对结果：当前轨道修正窗口已经明确，点火时序必须服从有限电力和姿态控制余量；再入准备仍未完成。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Gene Kranz", "Fred Haise"]) },
    { type: "progression", label: "推进再入准备阶段", contextId, reason: "observer_continue" },
    { type: "message", label: "玩家请求再入职责确认", contextId, actorId: playerId, message: "请把再入前仍未完成的事项按责任岗位列清楚，只保留能实际执行或验证的下一步，不要提前宣布安全着陆。" },
    { type: "player_turn", label: "自动完成再入职责回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "event", label: "再入窗口进入可执行范围", message: "地面回路确认再入窗口和关键姿态条件已进入可执行范围，但结果仍取决于机组按时完成最后校准。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Gene Kranz", "Jim Lovell"]) },
    { type: "progression", label: "请求收束再入阶段", contextId, reason: "observer_continue" },
    { type: "event", label: "水瓶座接管与断电完成", message: "乘组回报水瓶座已经接管生命支持，奥德赛按清单完成主要断电；当前资源开始按返航航段重新核算，仍需完成轨道修正。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Jim Lovell", "Fred Haise"]) },
    { type: "message", label: "玩家核对转移完成条件", contextId, actorId: playerId, message: "请确认转移已经从计划变成已执行事实，并说明下一项仍会改变返航结果的可观察任务。不要重复氧气事故或滤芯适配。" },
    { type: "player_turn", label: "自动完成转移核对回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求收束转移阶段", contextId, reason: "observer_continue" },
    { type: "event", label: "返航点火参数完成复核", message: "导航岗位提交返航点火参数复核：轨道窗口、姿态限制和剩余电力已形成一套可执行时序，但必须由 Flight 明确最后点火授权。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Gene Kranz", "Fred Haise"]) },
    { type: "message", label: "玩家请求点火授权链", contextId, actorId: playerId, message: "请让负责导航和执行的岗位分别报告已经核实的条件，再由有权限的人给出最后点火授权；只推进一个实际决策。" },
    { type: "player_turn", label: "自动完成点火授权回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求收束轨道修正阶段", contextId, reason: "observer_continue" },
    { type: "event", label: "再入姿态与通信复核完成", message: "再入前复核报告已回到 Flight：通信链路、姿态手动备份和再入窗口均有责任岗位确认，最后待确认项是乘组按时执行并回报姿态。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Gene Kranz", "Jim Lovell", "Fred Haise"]) },
    { type: "message", label: "玩家请求最终执行状态", contextId, actorId: playerId, message: "请只报告再入前仍未完成的一项执行动作，以及它由谁回报。不要提前宣布结果，等正式回报后再收束。" },
    { type: "player_turn", label: "自动完成再入复核回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求收束返航阶段", contextId, reason: "observer_continue" },
    { type: "snapshot", label: "保存长程恢复点", completion: "immediate" },
    { type: "pause", label: "暂停世界", completion: "immediate" },
    { type: "resume", label: "恢复世界", completion: "immediate" },
    { type: "restore", label: "从恢复点冷恢复", completion: "immediate" },
    { type: "message", label: "恢复后继续玩家参与", contextId, actorId: playerId, message: "恢复记录后继续。请直接承接刚才的未决风险，不要重新演一遍氧气罐事故或滤芯适配。" },
    { type: "player_turn", label: "自动完成恢复后玩家回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求最终阶段收束", contextId, reason: "observer_continue" },
    { type: "event", label: "水瓶座救生艇模式稳定接管", message: "乘组回报水瓶座生命支持已稳定接管，奥德赛主要系统按清单完成关断；转移执行事实已经确认，下一项关键工作是完成返航轨道修正。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Jim Lovell", "Fred Haise", "Gene Kranz"]) },
    { type: "message", label: "玩家核对救生艇交接", contextId, actorId: playerId, message: "请只承接已经确认的救生艇接管结果，说明返航轨道修正还缺哪一个可观察步骤，不要回到爆炸原因或早先的评估。" },
    { type: "player_turn", label: "自动完成救生艇交接回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求进入轨道修正幕", contextId, reason: "observer_continue" },
    { type: "event", label: "返航修正完成并锁定再入窗口", message: "导航岗位回报返航修正已经完成，姿态与剩余电力满足既定再入窗口；通信和手动备份仍需在再入前逐项确认。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Gene Kranz", "Jim Lovell", "Fred Haise"]) },
    { type: "message", label: "玩家请求再入前最后核对", contextId, actorId: playerId, message: "请把返航修正已完成这一事实作为前提，只报告再入前尚未完成的一项执行核对，以及负责回报的人。" },
    { type: "player_turn", label: "自动完成轨道修正回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求进入再入收束幕", contextId, reason: "observer_continue" },
    { type: "event", label: "再入通信与姿态确认", message: "再入前回路确认通信链路、手动姿态备份和再入窗口均已由责任岗位复核，乘组准备按时执行并回报最后姿态。", contextIds: [contextId], actorIds: compactIds(actorIdByName, ["Jim Lovell", "Jack Swigert", "Fred Haise", "Gene Kranz"]) },
    { type: "message", label: "玩家请求最终回报", contextId, actorId: playerId, message: "请等待乘组正式回报再入执行状态，再收束这条返航链；不要提前宣布安全结果。" },
    { type: "player_turn", label: "自动完成再入确认回合", contextId, actorId: playerId, mode: "auto", optional: true },
    { type: "progression", label: "请求最终返航结果", contextId, reason: "observer_continue" },
  ],
};

console.log(`[CVWB Marathon] source documents=${sourceBundle.documents.length} chunks=${sourceBundle.chunks.length}`);
console.log(`[CVWB Marathon] world actors=${definition.actors.length} chapters=${definition.chapters?.length ?? 0}`);
const worldReport = await new WorldRunLab({
  scenario,
  providers: { director: directorProvider, character: characterProvider, mode: "live" },
  directorReasoning: options.directorReasoning,
  sourceProvider,
  // Model calls remain live. The manual clock only removes product pacing and
  // fast-forwards Ambient/lifecycle timers so the benchmark reaches its real
  // narrative boundary instead of stopping at the first quiet interval.
  timeMode: "accelerated",
  debug: true,
  // Product steps must not overtake a pending Player proposal or a running
  // Narrator turn. Each scripted input is applied only after the previous
  // runtime chain reaches a stable boundary, matching real user interaction.
  stepCompletion: "settled",
  quietPeriodMs: 1_200,
  pollIntervalMs: 25,
  stepTimeoutMs: options.stepTimeoutMs,
  scheduledDrainGraceMs: 20_000,
  backgroundTimeoutMs: 60_000,
  onProgress(progress) {
    const sequence = progress.eventSequence === undefined ? "" : ` seq=${progress.eventSequence}`;
    console.log(`[CVWB World] ${progress.phase}${sequence} ${progress.message}`);
  },
}).run();
await writeFile(path.join(outputDirectory, "world-run.json"), `${JSON.stringify(worldReport, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "world-run.md"), renderWorldRunReport(worldReport), "utf8");
await writeFile(path.join(outputDirectory, "session-log.json"), `${JSON.stringify({
  runId,
  studio: { phases: studioPhases, usage: studioUsage, researchRuns },
  world: worldReport,
}, null, 2)}\n`, "utf8");

const deterministic = scoreMarathon({ draft, validation, studioPhases, studioUsage, researchRuns, sourceBundle, retrievalProbes, worldReport, playerId });
let judge;
try {
  judge = await judgeContent(directorProvider, draft, researchRuns, worldReport);
} catch (error) {
  judge = {
    percentage: 0,
    overall: 0,
    scores: {},
    strengths: [],
    issues: [`内容裁判调用失败：${error instanceof Error ? error.message : String(error)}`],
    verdict: "内容裁判未完成；World 原始报告已保留。",
  };
}
const finalScore = Math.round((deterministic.percentage * 0.6 + judge.percentage * 0.4) * 100) / 100;
const result = {
  schemaVersion: 1,
  benchmark: { name: "ChatVerse WorldBench Product Marathon", abbreviation: "CVWB-PM", copyright: "Copyright (c) MengPaul" },
  runId,
  subject: "Apollo 13 historical reconstruction",
  score: { percentage: finalScore, deterministic: deterministic.percentage, contentJudge: judge.percentage },
  studio: { phases: studioPhases, usage: studioUsage, researchRuns, draftSummary: summarizeDraft(draft) },
  source: {
    documents: sourceBundle.documents.length,
    sections: sourceBundle.sections.length,
    chunks: sourceBundle.chunks.length,
    characters: sourceBundle.documents.reduce((sum, document) => sum + document.text.length, 0),
    probes: retrievalProbes.map(({ query, hits }) => ({ query, hits: hits.slice(0, 3) })),
  },
  world: worldReport,
  checks: deterministic.checks,
  contentJudge: judge,
};
await writeFile(path.join(outputDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "content-review.md"), renderProductReport(result), "utf8");

console.log(`[CVWB Marathon] score=${finalScore.toFixed(2)} deterministic=${deterministic.percentage.toFixed(2)} judge=${judge.percentage.toFixed(2)}`);
console.log(`[CVWB Marathon] world calls=${worldReport.metrics.tokenUsage.requestCount} tokens=${worldReport.metrics.tokenUsage.totalTokens} events=${worldReport.metrics.eventCount}`);
console.log(`[CVWB Marathon] memory updates=${worldReport.metrics.eventsByType["actor.memory.updated"] ?? 0} beats=${worldReport.metrics.eventsByType["narrative.beat.recorded"] ?? 0}`);
for (const check of deterministic.checks) console.log(`[CVWB Marathon] ${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
console.log(`[CVWB Marathon] artifacts=${outputDirectory}`);
process.exitCode = deterministic.hardFailures.length || worldReport.errors.length ? 1 : 0;

function parseArgs(values) {
  const output = {
    envFile: "apps/world-server/.env",
    outputDirectory: ".artifacts/world-benchmark",
    requestTimeoutMs: 120_000,
    stepTimeoutMs: 180_000,
    targetEvents: 95,
    maxBeats: undefined,
    directorReasoning: undefined,
    resumeDirectory: undefined,
    providerConfigFile: undefined,
  };
  for (const value of values) {
    if (value.startsWith("--env=")) output.envFile = value.slice(6);
    else if (value.startsWith("--out=")) output.outputDirectory = value.slice(6);
    else if (value.startsWith("--target-events=")) output.targetEvents = positiveInteger(value.slice(16), output.targetEvents);
    else if (value.startsWith("--max-beats=")) output.maxBeats = positiveInteger(value.slice(12), output.maxBeats);
    else if (value === "--director-reasoning=off" || value === "--director-reasoning=disabled") output.directorReasoning = false;
    else if (value === "--director-reasoning=on" || value === "--director-reasoning=enabled") output.directorReasoning = true;
    else if (value.startsWith("--resume=")) output.resumeDirectory = value.slice(9);
    else if (value.startsWith("--provider-config=")) output.providerConfigFile = value.slice("--provider-config=".length);
    else if (value.startsWith("--request-timeout-ms=")) output.requestTimeoutMs = positiveInteger(value.slice(21), output.requestTimeoutMs);
    else if (value.startsWith("--step-timeout-ms=")) output.stepTimeoutMs = positiveInteger(value.slice(18), output.stepTimeoutMs);
    else throw new Error(`未知参数：${value}`);
  }
  return output;
}

function buildSourceDocuments(worldDraft, runs) {
  const sourceList = (worldDraft.researchSources ?? []).map((source) => `- [${source.title}](${source.url})：${source.note}`).join("\n");
  const actors = worldDraft.actors.map((actor) => [
    `## ${actor.card.name}`,
    `- 定位：${actor.role}`,
    `- 描述：${actor.card.description}`,
    `- 人格：${actor.card.personality}`,
    `- 世界处境：${actor.background ?? actor.card.scenario}`,
    `- 表达样例：${actor.card.messageExample}`,
  ].join("\n")).join("\n\n");
  const research = runs.map((run, index) => [
    `## 检索 ${index + 1}：${run.query}`,
    `用途：${run.purpose}`,
    "",
    run.summary,
    "",
    "### 来源",
    ...run.sources.map((source) => `- [${source.title}](${source.url})：${source.note}`),
  ].join("\n")).join("\n\n");
  const contexts = worldDraft.contexts.map((context) => [
    `## ${context.name}`,
    `- 主题：${context.scene.topic}`,
    `- 氛围：${context.scene.atmosphere}`,
    `- 开场：${context.opening}`,
    `- 规则：${(context.scene.rules ?? []).join("；")}`,
  ].join("\n")).join("\n\n");
  const chapters = worldDraft.chapters.map((chapter) => [
    `- **${chapter.title}**`,
    `  - 纲要：${chapter.treatment}`,
    `  - 目标结果：${chapter.targetOutcome}`,
  ].join("\n")).join("\n");
  return [
    { path: "01-world-foundation.md", title: "世界基础与资料边界", format: "markdown", content: `# ${worldDraft.metadata.name}\n\n## 前提\n${worldDraft.premise}\n\n## 核心背景\n${worldDraft.lore.core}\n\n## 规则\n${worldDraft.lore.rules.map((rule) => `- ${rule}`).join("\n")}\n\n## Studio 引用来源\n${sourceList}` },
    { path: "02-historical-research.md", title: "联网历史研究", format: "markdown", content: `# Apollo 13 联网研究记录\n\n${research}` },
    { path: "03-actors-and-authority.md", title: "人物职责与知识边界", format: "markdown", content: `# 人物职责与知识边界\n\n${actors}\n\n## 玩家\n${JSON.stringify(worldDraft.player?.playerCard ?? worldDraft.player?.profile, null, 2)}` },
    { path: "04-opening-and-chapters.md", title: "开场与剧情章节", format: "markdown", content: `# 开场 Context\n\n${contexts}\n\n# Chapters\n\n${chapters}` },
  ];
}

function scoreMarathon(input) {
  const report = input.worldReport;
  const transcript = report.transcript;
  const normalized = transcript.map((entry) => normalize(entry.text)).filter(Boolean);
  const distinctRatio = normalized.length ? new Set(normalized).size / normalized.length : 0;
  const aiSpeakers = new Set(transcript.filter((entry) => entry.actorId && entry.actorId !== input.playerId).map((entry) => entry.actorId));
  const sourceTools = report.metrics.toolUsage.byName.retrieve_source ?? 0;
  const sourceBasedBeats = report.finalSnapshot.narrative.beats.filter((beat) => beat.sourceBasis?.chunkIds?.length).length;
  const memoryUpdated = report.events.filter((event) => event.type === "actor.memory.updated").length;
  const memoryOperations = report.events.filter((event) => event.type === "actor.memory.updated").reduce((sum, event) => sum + event.payload.createdNodeIds.length + event.payload.revisedNodeIds.length + event.payload.deletedNodeIds.length, 0);
  const checks = [
    check("studio-research", input.researchRuns.length >= 3, `${input.researchRuns.length}/3`, true),
    check("studio-valid", input.validation.valid, `${input.validation.issues.length} issues`, true),
    check("studio-world", input.draft.actors.length >= 4 && Boolean(input.draft.player) && input.draft.chapters.length >= 2, `${input.draft.actors.length} actors, ${input.draft.chapters.length} chapters`, true),
    check("source-size", input.sourceBundle.documents.length >= 4 && input.sourceBundle.chunks.length >= 6, `${input.sourceBundle.documents.length} docs, ${input.sourceBundle.chunks.length} chunks`, true),
    check("retrieval", input.retrievalProbes.every((probe) => probe.hits.length > 0), input.retrievalProbes.map((probe) => probe.hits.length).join("/"), true),
    check("director-retrieval", sourceTools >= 3, `${sourceTools} source tool calls`, true),
    check("source-grounded-beat", sourceBasedBeats >= 1, `${sourceBasedBeats} grounded beats`, false),
    check("beats", report.finalSnapshot.narrative.beats.length >= 5 && report.finalSnapshot.narrative.beats.length <= 8, `${report.finalSnapshot.narrative.beats.length} beats`, true),
    check("dialogue-volume", transcript.length >= 20, `${transcript.length} visible entries`, false),
    check("speaker-diversity", aiSpeakers.size >= 3, `${aiSpeakers.size} AI speakers`, false),
    check("no-exact-repeat", distinctRatio >= 0.88, `${(distinctRatio * 100).toFixed(1)}% distinct`, false),
    check("player-participation", transcript.filter((entry) => entry.actorId === input.playerId).length >= 5, `${transcript.filter((entry) => entry.actorId === input.playerId).length} player entries`, false),
    check("memory-curation", memoryUpdated >= 1 && memoryOperations >= 1, `${memoryUpdated} updates, ${memoryOperations} operations`, false),
    check("memory-bounded", report.finalSnapshot.actorMemories.every((memory) => memory.nodes.length <= 192), report.finalSnapshot.actorMemories.map((memory) => memory.nodes.length).join("/"), true),
    check("stable", report.errors.length === 0 && report.metrics.stability.stallCount === 0, `${report.errors.length} errors, ${report.metrics.stability.stallCount} stalls`, true),
  ];
  const percentage = checks.filter((item) => item.passed).length / checks.length * 100;
  return { percentage, checks, hardFailures: checks.filter((item) => item.hard && !item.passed) };
}

async function judgeContent(judgeProvider, worldDraft, runs, report) {
  const sourceSummary = runs.map((run) => `${run.query}\n${run.summary}`).join("\n\n").slice(0, 12_000);
  const transcript = report.transcript.map((entry) => `${entry.speaker ?? entry.kind}: ${entry.text}`).join("\n").slice(-30_000);
  const content = await judgeProvider.complete({
    systemPrompt: "你是严苛的非虚构互动叙事质量评审。只根据给定资料和演出记录评分，不因系统规模给宽容分。玩家输入包含刻意设计的越权、后见之明和错误前提压力测试；不要因玩家说出这些内容本身扣分，只评价 AI 是否纠正、拒绝或被其带偏。输出严格 JSON，不要 Markdown。",
    userPrompt: [
      "请按 0-10 分评价六项：factualGrounding、narrativeCoherence、characterIntegrity、dialoguePacing、playerResponsiveness、memoryContinuity。",
      "同时给出 overall（0-10）、strengths（最多3条）、issues（最多5条）、verdict。",
      "重点检查：AI 是否把后见之明提前给角色、是否重复/拖沓、AI 人物权限是否错乱、玩家问题是否被直接回应、AI 是否妥善处理玩家故意给出的错误前提、恢复后是否重演、长期记忆是否体现在连续性而非生硬复述。",
      `[世界] ${worldDraft.metadata.name}\n${worldDraft.premise}`,
      `[联网资料摘要]\n${sourceSummary}`,
      `[运行记录]\n${transcript}`,
    ].join("\n\n"),
    maxTokens: 3_000,
    responseFormat: { type: "json_object" },
    thinking: "disabled",
    requestContext: { purpose: "world_benchmark_judge" },
  });
  const parsed = parseJson(content);
  const keys = ["factualGrounding", "narrativeCoherence", "characterIntegrity", "dialoguePacing", "playerResponsiveness", "memoryContinuity"];
  const scores = Object.fromEntries(keys.map((key) => [key, boundedScore(parsed[key])]));
  const overall = boundedScore(parsed.overall ?? keys.reduce((sum, key) => sum + scores[key], 0) / keys.length);
  return {
    percentage: overall * 10,
    overall,
    scores,
    strengths: stringList(parsed.strengths, 3),
    issues: stringList(parsed.issues, 5),
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
  };
}

function renderProductReport(result) {
  const lines = [
    "# ChatVerse WorldBench Product Marathon",
    "",
    `- 版权：${result.benchmark.copyright}`,
    `- 场景：${result.subject}`,
    `- 总分：${result.score.percentage.toFixed(2)}`,
    `- 基础设施分：${result.score.deterministic.toFixed(2)}`,
    `- 内容质量分：${result.score.contentJudge.toFixed(2)}`,
    `- Studio：${result.studio.usage.researchCalls} 次联网检索，${result.studio.usage.providerCalls} 次创作调用，${result.studio.usage.totalTokens} tokens`,
    `- Source：${result.source.documents} 份 Markdown，${result.source.sections} sections，${result.source.chunks} chunks，${result.source.characters} chars`,
    `- World：${result.world.metrics.eventCount} events，${result.world.transcript.length} visible entries，${result.world.metrics.tokenUsage.totalTokens} tokens`,
    "",
    "## 分项验收",
    "",
    ...result.checks.map((item) => `- [${item.passed ? "x" : " "}] ${item.id}：${item.detail}`),
    "",
    "## 内容评分",
    "",
    ...Object.entries(result.contentJudge.scores).map(([key, value]) => `- ${key}：${value}/10`),
    "",
    `结论：${result.contentJudge.verdict}`,
    "",
    "### 优点",
    "",
    ...result.contentJudge.strengths.map((item) => `- ${item}`),
    "",
    "### 问题",
    "",
    ...result.contentJudge.issues.map((item) => `- ${item}`),
    "",
    "## Studio 阶段",
    "",
    ...result.studio.phases.map((phase) => `- ${phase.name} / revision ${phase.revision}：${phase.summary}`),
    "",
    "## 完整演出记录",
    "",
    ...result.world.transcript.map((entry) => `- [${entry.sequence}] **${entry.speaker ?? entry.kind}**：${entry.text.replace(/\s+/g, " ")}`),
  ];
  if (result.world.errors.length) lines.push("", "## 运行错误", "", ...result.world.errors.map((error) => `- ${error}`));
  return `${lines.join("\n")}\n`;
}

function summarizeDraft(worldDraft) {
  return {
    revision: worldDraft.revision,
    name: worldDraft.metadata.name,
    actors: worldDraft.actors.map((actor) => actor.card.name),
    player: worldDraft.player?.profile.name,
    contexts: worldDraft.contexts.map((context) => context.name),
    chapters: worldDraft.chapters.map((chapter) => chapter.title),
    researchSources: worldDraft.researchSources?.length ?? 0,
  };
}

function addUsage(target, usage) {
  if (!usage || typeof usage.totalTokens !== "number") return;
  target.totalTokens += usage.totalTokens;
}

function compactIds(index, names) {
  return names.map((name) => index.get(name)).filter(Boolean);
}

function normalize(value) {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function check(id, passed, detail, hard) {
  return { id, passed, detail, hard };
}

function parseJson(value) {
  const cleaned = String(value).trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  return JSON.parse(cleaned);
}

function boundedScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10, number)) : 0;
}

function stringList(value, limit) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, limit) : [];
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function reconstructResearchRuns(bundle, worldDraft) {
  const researchDocument = bundle.documents.find((document) => document.path === "02-historical-research.md");
  const text = researchDocument?.text ?? "";
  const sections = text.split(/^## 检索 \d+：/mu).slice(1);
  const sources = worldDraft.researchSources ?? [];
  return sections.map((section, index) => {
    const [queryLine = `historical research ${index + 1}`, ...rest] = section.split("\n");
    return {
      query: queryLine.trim(),
      purpose: "从已持久化的 Studio Source 恢复",
      summary: rest.join("\n").trim(),
      sources,
    };
  });
}
