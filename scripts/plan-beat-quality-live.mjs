import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { ChatVerse } from "@chatverse/core";
import { createEnvironmentProviders } from "@chatverse/world-server/environment";
import { compileWorldSourceBundle, InMemoryWorldSourceProvider } from "@chatverse/world-source";

const options = parseArgs(process.argv.slice(2));
const envPath = path.resolve(options.envFile);
if (existsSync(envPath)) loadEnvFile(envPath);
if (!process.env.PROVIDER_TIMEOUT_MS) process.env.PROVIDER_TIMEOUT_MS = String(options.timeoutMs);

const providerConfig = options.providerConfigFile
  ? JSON.parse(await readFile(path.resolve(options.providerConfigFile), "utf8"))
  : undefined;
const providers = await createEnvironmentProviders(providerConfig);
const traces = [];
const directorProvider = traceProvider(providers.directorProvider, traces);
const sourceBundle = createSourceBundle();
const sourceProvider = new InMemoryWorldSourceProvider({ bundles: [sourceBundle] });
const definition = createDefinition(sourceBundle);
const outputDirectory = path.resolve(
  options.outputDirectory,
  `plan-beat-apollo13-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
await mkdir(outputDirectory, { recursive: true });

const world = new ChatVerse({
  directorProvider,
  characterProvider: passiveProvider(),
}).createWorld(definition, {
  sourceProvider,
  debug: { enabled: true, maxEvents: 2_000 },
});

const events = [];
const notifications = [];
world.onEvent((event) => events.push(serializable(event)));
world.onNotification((notification) => {
  notifications.push(serializable(notification));
  if (notification.type.startsWith("director.")) {
    console.log(`[Director] ${notification.type} ${compact(notification.payload)}`);
  }
});

console.log(`[PlanBeat] provider=${directorProvider.profile?.providerName ?? "configured"} model=${directorProvider.profile?.model ?? "default"}`);
console.log(`[PlanBeat] reasoning=${options.reasoning ? "on" : "off"} timeout=${options.timeoutMs}ms`);
console.log(`[PlanBeat] source=${sourceBundle.id}@${sourceBundle.revision} chunks=${sourceBundle.chunks.length}`);

let runError;
try {
  world.start();
  world.requestProgression({
    contextId: "mission-control",
    reason: "继续当前主线：在不提前跳到返航结局的前提下，规划二氧化碳滤芯危机的下一幕。",
  });
  await waitUntil(
    () => world.snapshot().narrative.beats.length > 0
      || hasDirectorError(notifications)
      || directorAttemptsExhausted(notifications),
    options.timeoutMs * 2,
  );
} catch (error) {
  runError = error instanceof Error ? error.message : String(error);
} finally {
  world.stop();
}

const snapshot = world.snapshot();
const beat = snapshot.narrative.beats.at(-1);
const candidates = extractBeatWorkflowCandidates(traces);
const bestCandidate = candidates.find((candidate) => candidate.value)?.value;
const assessedBeat = beat ?? bestCandidate;
const assessment = assessBeat(assessedBeat, traces, sourceBundle, Boolean(beat));
if (runError) assessment.failures.unshift(`运行失败：${runError}`);
for (const candidate of candidates.filter((item) => item.error)) {
  assessment.failures.push(`第 ${candidate.round} 轮 Beat JSON 不是合法对象：${candidate.error}`);
}

await Promise.all([
  writeJson(path.join(outputDirectory, "session-log.json"), {
    provider: directorProvider.profile,
    traces,
    notifications,
    events,
  }),
  writeJson(path.join(outputDirectory, "generated-beat.json"), beat ?? null),
  writeJson(path.join(outputDirectory, "plan-beat-candidates.json"), candidates),
  writeJson(path.join(outputDirectory, "source-bundle.json"), sourceBundle),
  writeJson(path.join(outputDirectory, "result.json"), { assessment, beat, bestCandidate, runError }),
  writeFile(path.join(outputDirectory, "quality-report.md"), renderReport(assessment, beat, bestCandidate, traces), "utf8"),
]);

console.log(`[PlanBeat] rounds=${traces.length} beat=${beat?.title ?? "NONE"}`);
console.log(`[PlanBeat] score=${assessment.score}/100 verdict=${assessment.verdict}`);
for (const failure of assessment.failures) console.log(`[FAIL] ${failure}`);
for (const warning of assessment.warnings) console.log(`[WARN] ${warning}`);
console.log(`[PlanBeat] artifact=${outputDirectory}`);
if (!beat || assessment.score < options.minimumScore) process.exitCode = 1;

function createDefinition(bundle) {
  return {
    metadata: {
      id: "plan-beat-quality-apollo13",
      name: "阿波罗13号：方罐与圆孔",
      description: "只测试 Director 下一幕剧本质量的固定史实压力场景。",
    },
    lore: {
      entries: [{
        keys: ["Apollo 13", "阿波罗13号", "任务控制中心"],
        content: "1970年4月，阿波罗13号事故后的处置必须遵守当时已知事实、岗位权限和通信延迟；不得让角色提前知道调查结论。",
        priority: 10,
        position: "before",
        constant: true,
      }],
    },
    sources: [{ bundleId: bundle.id, revision: bundle.revision, fidelity: "strict" }],
    actors: [
      actor("gene-kranz", "Gene Kranz", "当班 Flight Director，负责统筹任务控制团队并作出飞行控制决策。", "克制、明确，要求各控制席先报告事实和风险。"),
      actor("jim-lovell", "Jim Lovell", "阿波罗13号指令长，位于航天器内，执行地面确认后的程序。", "沉着、务实，会明确报告机组可观察到的状态。"),
      actor("jack-swigert", "Jack Swigert", "指令舱驾驶员，负责指令舱系统操作。", "简洁、技术化，不越过地面程序自行杜撰方案。"),
      actor("fred-haise", "Fred Haise", "登月舱驾驶员，负责登月舱系统与资源状态。", "谨慎报告环境与生命保障数据。"),
      {
        id: "player-recorder",
        kind: "character",
        playerControlled: true,
        card: {
          name: "飞行控制记录员",
          description: "休斯敦任务控制中心的记录员，不是 Flight Director 或工程主管。",
          personality: "严谨，擅长对照时间线和追问信息来源。",
          scenario: "坐在主控室后排，整理各控制席和机组的已确认信息。",
          messageExample: "这项读数的时间戳和来源分别是什么？",
        },
        playerCard: {
          name: "飞行控制记录员",
          identity: "任务控制中心记录员",
          background: "负责整理通话、时间线和确认状态，没有下达飞行指令的权限。",
          personality: "严谨、重视来源",
          appearance: "佩戴耳机，面前摊着任务日志",
          speechStyle: "简洁询问，区分事实、建议和待确认事项",
          boundaries: "不得代替 Flight Director 下令，不得凭空解决工程问题",
        },
      },
    ],
    contexts: [{
      id: "mission-control",
      kind: "chat",
      name: "休斯敦任务控制中心",
      actorIds: ["gene-kranz", "jim-lovell", "jack-swigert", "fred-haise", "player-recorder"],
      scene: {
        groupName: "Mission Control",
        topic: "登月舱二氧化碳上升与滤芯接口不兼容",
        atmosphere: "事故后的高压工作时段；所有结论必须区分已确认、推测和待验证。",
        state: "flowing",
        rules: ["地面负责设计并验证程序，机组负责报告和执行。", "记录员可整理和追问，但无权下令。"],
      },
      runtime: { pacingMultiplier: 0, actorRuntime: { ambient: "off" } },
      initiallyActive: true,
    }],
    relations: [],
    chapters: [{
      id: "chapter-safe-return",
      title: "把受损的阿波罗13号带回地球",
      treatment: "氧气罐事故迫使任务放弃登月，地面与机组必须在有限电力、水、氧气和通信时间内共同维持返航可能。当前章节围绕登月舱二氧化碳吸收能力不足展开：团队先核实接口和现有材料，再由工程席制作并验证临时适配器，经过 Flight Director 批准后逐项传给机组执行，并用连续环境读数确认修正是否有效。每个岗位只能依据自己的职责报告，玩家作为记录员可以整理事实和追问来源，但不能代替飞行主管批准程序。适配器的有效性、首次测试失败的处理和后续返航决策都要留下可复核的行动条件；本章允许出现工程不确定性和程序修正，但不能提前把航迹修正或再入结果写成已发生。",
      targetOutcome: "地面与机组形成一条经过验证的生命保障处置链，并在确认临时适配器使二氧化碳趋势受控后，保留可执行的返航决策空间。",
      status: "active",
      actorIds: ["gene-kranz", "jim-lovell", "jack-swigert", "fred-haise", "player-recorder"],
      contextIds: ["mission-control"],
      beatIds: [],
    }],
    directorPolicy: {
      enabled: true,
      reasoning: options.reasoning,
      maxToolRounds: 2,
      maxProviderRetries: 1,
      debounceMs: 0,
      minIntervalMs: 0,
      narratorDebounceMs: 60_000,
      contextSuspendAfterMs: 600_000,
    },
    actorMemoryPolicy: { enabled: false },
  };
}

function actor(id, name, description, personality) {
  return {
    id,
    kind: "character",
    card: {
      name,
      description,
      personality,
      scenario: "正在阿波罗13号事故处置链路中，只掌握岗位范围内的实时信息。",
      messageExample: "先确认读数、资源和程序，再决定下一步。",
    },
  };
}

function createSourceBundle() {
  return compileWorldSourceBundle({
    id: "apollo13-source",
    revision: 1,
    name: "Apollo 13 CO2 Crisis Test Corpus",
    description: "用于下一幕规划质量基准的固定资料。",
    chunkTargetChars: 1_200,
    documents: [
      {
        path: "sources/01-current-state.md",
        title: "当前状态与知识边界",
        content: `# 当前状态与知识边界\n\n时间位于氧气罐事故之后。登月任务已经取消，指令舱被关闭以保留再入电力，三名宇航员暂时使用登月舱作为救生艇。当前的直接压力是三个人产生的二氧化碳超过登月舱原本供两人短期使用的设计负荷。\n\n任务控制中心已经确认：指令舱备有方形氢氧化锂滤芯，登月舱环境控制系统的接口为圆形，二者不能直接连接。此刻团队尚未完成适配器，也没有观察到改装后的读数。后续返航航迹和再入程序不属于当前这一幕的结果。`,
      },
      {
        path: "sources/02-adapter-procedure.md",
        title: "临时适配器的工程处置链",
        content: `# 临时适配器的工程处置链\n\n地面工程人员必须只使用航天器内已经存在的材料构造方案。可用材料包括塑料袋、任务手册硬纸板、软管、胶带和袜子。地面先搭建实物原型，确认气流经过方形滤芯，再把步骤拆成能经语音逐项传递的程序。\n\n机组不能只听到“做一个适配器”；他们需要逐项识别材料、摆放滤芯、密封塑料袋、连接软管并检查气流。程序执行后不能立刻宣告危机解决，必须观察环境读数是否开始下降。当前阶段的可观察结果，是装置投入使用且二氧化碳趋势开始受控。`,
      },
      {
        path: "sources/03-roles-and-scene.md",
        title: "岗位权限与可演出结构",
        content: `# 岗位权限与可演出结构\n\nFlight Director Gene Kranz 负责汇总控制席判断、确定优先级并批准向机组发送程序。地面生命保障与工程人员负责提出并实物验证适配方案；若当前固定角色中没有能承担该工作的人，下一幕应准备一名有明确岗位、入口和即时目标的临时工程角色。\n\nJim Lovell 统筹机组执行和对地沟通；Jack Swigert 熟悉指令舱物品；Fred Haise 熟悉登月舱环境系统。玩家是记录员，只能整理已确认事实、发现步骤矛盾和追问来源，不能替 Kranz 批准程序。\n\n适合一幕完成的因果链是：读数压力明确 → 地面盘点兼容问题与可用材料 → 工程角色搭建并验证原型 → Kranz 批准逐项上行 → 机组按步骤组装 → 通风运行后观察趋势。不要在这一幕直接推进到航迹修正、服务舱成因调查或地球再入。`,
      },
    ],
  });
}

function traceProvider(provider, target) {
  return {
    profile: provider.profile,
    complete: (params) => provider.complete(params),
    stream: (params) => provider.stream(params),
    async chat(params) {
      const startedAt = Date.now();
      const request = normalizeRequest(params);
      const round = target.length + 1;
      console.log(`[PlanBeat] round=${round} tools=${request.tools.map((tool) => tool.name).join(",") || "none"} choice=${request.toolChoice ?? "auto"}`);
      try {
        const response = await provider.chat(params);
        target.push({ round, durationMs: Date.now() - startedAt, request, response: serializable(response) });
        console.log(`[PlanBeat] round=${round} completed ${Date.now() - startedAt}ms calls=${response.toolCalls?.map((call) => call.function.name).join(",") || "none"}`);
        return response;
      } catch (error) {
        target.push({ round, durationMs: Date.now() - startedAt, request, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
  };
}

function normalizeRequest(params) {
  return {
    messages: serializable(params.messages),
    tools: (params.tools ?? []).map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })),
    toolChoice: params.toolChoice,
    thinking: params.thinking,
    reasoningEffort: params.reasoningEffort,
    maxTokens: params.maxTokens,
    stream: params.stream,
    requestContext: params.requestContext,
  };
}

function passiveProvider() {
  return {
    async complete() { return ""; },
    async *stream() {},
    async chat() { return { content: "", toolCalls: [] }; },
  };
}

function assessBeat(beat, traces, bundle, committed) {
  const checks = [];
  const add = (name, points, passed, detail) => checks.push({ name, points, earned: passed ? points : 0, passed, detail });
  const script = beat?.script;
  const text = JSON.stringify(beat ?? {}).toLowerCase();
  const playerRole = script?.cast?.find((actor) => actor.actorId === "player-recorder")?.roleInScene ?? "";
  const retrievedText = traces.flatMap((trace) => trace.request.messages)
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const sourceIds = new Set(bundle.chunks.map((chunk) => chunk.id));

  const validWorkflow = traces.length >= 1 && traces.length <= 2 && traces.every((trace) => (
    trace.request.tools.length === 0 && trace.request.toolChoice === "none" && trace.request.thinking === "disabled"
  ));
  add("固定 JSON 工作流", 5, validWorkflow, `实际 ${traces.length} 次请求；模型工具数 ${traces.map((trace) => trace.request.tools.length).join("/")}`);
  add("Host 预先检索资料", 5, retrievedText.includes("方形") && retrievedText.includes("圆形") && retrievedText.includes("塑料袋"), "首轮用户上下文应直接包含关键工程资料");
  add("Host 成功提交", 10, committed, committed ? "Beat 已写入 World" : "模型返回了候选 Beat，但 Host 未接受");
  add("绑定正确章节", 10, beat?.chapterId === "chapter-safe-return", `${beat?.chapterId ?? "无"}`);
  add("完整长幕结构", 15, beat?.kind === "full_scene" && (script?.stages?.length ?? 0) >= 3 && (script?.development?.length ?? 0) >= 3 && (script?.causalChain?.length ?? 0) >= 3, `stages=${script?.stages?.length ?? 0}`);
  add("角色回合预算足够", 10, (beat?.minimumActorTurns ?? 0) >= 6 && (beat?.maximumActorTurns ?? 0) >= 12 && beat.maximumActorTurns > beat.minimumActorTurns, `${beat?.minimumActorTurns ?? 0}-${beat?.maximumActorTurns ?? 0}`);
  add("工程因果链具体", 15, ["滤芯", "材料", "原型", "程序", "读数"].filter((term) => text.includes(term)).length >= 4, "应覆盖材料、验证、上行、执行与读数");
  add("玩家权限正确", 10, /记录|复核|追问/.test(playerRole) && !/(批准|下令|决定程序)/.test(playerRole), playerRole || "玩家未进入本幕 Cast");
  add("需要时准备工程角色", 8, (script?.sceneActors?.length ?? 0) >= 1 && script.sceneActors.some((actor) => /工程|生命保障|环境/.test(`${actor.role}${actor.objective}`)), `sceneActors=${script?.sceneActors?.length ?? 0}`);
  add("没有提前跳到后续结局", 7, !/(溅落|再入完成|返回地球|事故原因查明|航迹修正完成)/.test(text), "本幕只能解决 CO2 适配阶段");
  add("来源可追溯", 5, Boolean(beat?.sourceBasis?.chunkIds?.length) && beat.sourceBasis.chunkIds.every((id) => sourceIds.has(id)), `${beat?.sourceBasis?.chunkIds?.length ?? 0} chunks`);

  const score = checks.reduce((sum, check) => sum + check.earned, 0);
  const failures = checks.filter((check) => !check.passed && check.points >= 10).map((check) => `${check.name}：${check.detail}`);
  const warnings = checks.filter((check) => !check.passed && check.points < 10).map((check) => `${check.name}：${check.detail}`);
  return {
    score,
    verdict: score >= 85 ? "excellent" : score >= 70 ? "usable" : score >= 55 ? "weak" : "failed",
    checks,
    failures,
    warnings,
  };
}

function renderReport(assessment, beat, bestCandidate, traces) {
  const lines = [
    "# Plan Beat Quality Report",
    "",
    `- Score: **${assessment.score}/100**`,
    `- Verdict: **${assessment.verdict}**`,
    `- Provider rounds: **${traces.length}**`,
    `- Committed Beat: **${beat?.title ?? "未提交"}**`,
    `- Best candidate: **${bestCandidate?.title ?? "无合法候选"}**`,
    "",
    "## Checks",
    "",
    "| Check | Score | Result | Detail |",
    "| --- | ---: | --- | --- |",
    ...assessment.checks.map((check) => `| ${check.name} | ${check.earned}/${check.points} | ${check.passed ? "PASS" : "FAIL"} | ${check.detail} |`),
    "",
    "## Generated Beat",
    "",
    "```json",
    JSON.stringify(beat ?? bestCandidate ?? null, null, 2),
    "```",
    "",
    "## Provider Rounds",
    "",
    ...traces.map((trace) => `- Round ${trace.round}: ${trace.durationMs}ms; tools=${trace.request.tools.map((tool) => tool.name).join(", ")}; returned=${trace.response?.toolCalls?.map((call) => call.function.name).join(", ") || trace.error || "none"}`),
    "",
  ];
  return lines.join("\n");
}

function extractBeatWorkflowCandidates(traces) {
  const candidates = [];
  for (const trace of traces) {
    const raw = trace.response?.content?.trim();
    if (!raw) continue;
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end < start) throw new Error("响应中没有 JSON 对象");
      candidates.push({ round: trace.round, value: candidateBeat(JSON.parse(raw.slice(start, end + 1))) });
    } catch (error) {
      candidates.push({
        round: trace.round,
        rawArguments: raw,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return candidates;
}

function candidateBeat(args) {
  return {
    ...args,
    sourceBasis: args.sourceBundleId ? {
      bundleId: String(args.sourceBundleId).split("@")[0],
      bindingRevision: args.sourceBindingRevision,
      chunkIds: args.sourceChunkIds ?? [],
      adherence: args.sourceAdherence,
      note: args.sourceNote,
    } : undefined,
  };
}

function hasDirectorError(notifications) {
  return notifications.some((notification) => notification.type === "director.error" || notification.type === "director.task_failed");
}

function directorAttemptsExhausted(notifications) {
  const completed = notifications.filter((notification) => notification.type === "director.completed").length;
  const scheduledRetries = notifications.filter((notification) => notification.type === "director.retry_scheduled").length;
  return completed >= 2 && scheduledRetries >= 1;
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`等待 plan_beat 超时（${timeoutMs}ms）`);
}

function parseArgs(args) {
  const read = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  return {
    envFile: read("env", "apps/world-server/.env"),
    providerConfigFile: read("provider-config", "") || undefined,
    outputDirectory: read("output", ".artifacts/plan-beat-quality"),
    timeoutMs: Number(read("timeout-ms", "120000")),
    minimumScore: Number(read("minimum-score", "70")),
    reasoning: read("reasoning", "off") === "on",
  };
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function compact(value) {
  const text = JSON.stringify(value ?? {});
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
