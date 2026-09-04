import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { WorldNarrator } from "@chatverse/core/testing";
import { createEnvironmentProviders } from "@chatverse/world-server/environment";

const options = parseArgs(process.argv.slice(2));
const envPath = path.resolve(options.envFile);
if (existsSync(envPath)) loadEnvFile(envPath);
if (!process.env.PROVIDER_TIMEOUT_MS) process.env.PROVIDER_TIMEOUT_MS = String(options.timeoutMs);
const providerConfig = options.providerConfigFile
  ? JSON.parse(await readFile(path.resolve(options.providerConfigFile), "utf8"))
  : undefined;
const providers = await createEnvironmentProviders(providerConfig);
const outputDirectory = path.resolve(
  options.outputDirectory,
  `narrator-beat-probe-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
await mkdir(outputDirectory, { recursive: true });

const variants = createBeatVariants();
const checkpoints = createCheckpoints();
const runs = [];

console.log(`[NarratorProbe] provider=${providers.characterProvider.profile?.providerName ?? "configured"} model=${providers.characterProvider.profile?.model ?? "default"}`);
console.log(`[NarratorProbe] variants=${variants.length} checkpoints=${checkpoints.length}`);

for (const variant of variants) {
  const traces = [];
  const narrator = new WorldNarrator(providers.characterProvider, (event) => {
    traces.push({ type: event.type, payload: event.payload });
  });
  console.log(`\n[NarratorProbe] variant=${variant.id} ${variant.name}`);
  const results = [];
  for (const checkpoint of checkpoints) {
    const startedAt = Date.now();
    try {
      const result = await narrator.run(
        checkpoint.mode,
        createView(variant.beat, checkpoint),
        AbortSignal.timeout(options.timeoutMs),
      );
      const assessment = assess(checkpoint, result);
      results.push({ checkpoint: checkpoint.id, durationMs: Date.now() - startedAt, result, assessment });
      console.log(`[NarratorProbe] ${checkpoint.id} ${Date.now() - startedAt}ms score=${assessment.score}/100 wake=${result.wakes.map((wake) => wake.actorId).join(",") || "none"} status=${result.beatStatus}`);
    } catch (error) {
      results.push({
        checkpoint: checkpoint.id,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        assessment: { score: 0, checks: [] },
      });
      console.log(`[NarratorProbe] ${checkpoint.id} ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  runs.push({
    variantId: variant.id,
    name: variant.name,
    description: variant.description,
    beat: variant.beat,
    score: average(results.map((result) => result.assessment.score)),
    results,
    traces,
  });
}

runs.sort((left, right) => right.score - left.score);
await Promise.all([
  writeJson(path.join(outputDirectory, "results.json"), runs),
  writeJson(path.join(outputDirectory, "beat-variants.json"), variants),
  writeFile(path.join(outputDirectory, "report.md"), renderReport(runs), "utf8"),
]);

console.log("\n[NarratorProbe] ranking");
for (const [index, run] of runs.entries()) console.log(`${index + 1}. ${run.name}: ${run.score}/100`);
console.log(`[NarratorProbe] artifact=${outputDirectory}`);
if (!runs.length || runs[0].score < options.minimumScore) process.exitCode = 1;

function createBeatVariants() {
  const common = {
    id: "probe-beat-co2",
    chapterId: "chapter-safe-return",
    title: "方形滤芯，圆形接口",
    minimumActorTurns: 8,
    maximumActorTurns: 16,
    status: "running",
    actorIds: ["gene-kranz", "life-support-engineer", "jim-lovell", "player-recorder"],
    contextIds: ["mission-control"],
    sourceEventIds: ["probe-event"],
    kind: "full_scene",
    occurredAt: 0,
    completesChapter: false,
  };
  const cast = [
    { actorId: "gene-kranz", roleInScene: "批准经过验证的上行程序，不能代替工程席验证技术细节。" },
    { actorId: "life-support-engineer", roleInScene: "搭建原型、验证气流、定位失败原因并修订程序。" },
    { actorId: "jim-lovell", roleInScene: "在程序获批后统筹机组组装并报告读数。" },
    { actorId: "player-recorder", roleInScene: "核对步骤与回读，不拥有工程批准权。" },
  ];
  const baseScript = {
    time: "1970年4月13日深夜",
    location: "休斯敦任务控制中心及通信连接的登月舱",
    cast,
    cause: "登月舱承载三人后CO2持续上升，而指令舱方形滤芯不能直接接入圆形接口。",
    development: [
      "地面盘点舱内材料并确认接口约束。",
      "工程席搭建原型并验证气流。",
      "Kranz批准验证后的逐项程序。",
      "机组组装、测试并修正密封问题。",
      "修正后CO2读数开始下降。",
    ],
    turningPoint: "第一次通风测试读数不降，工程席定位到塑料袋接缝漏气。",
    result: "加固后的适配器投入运行，CO2趋势开始下降。",
    causalChain: [
      "CO2上升迫使地面寻找兼容方案。",
      "材料盘点使原型成为可能。",
      "原型验证使程序可以上行。",
      "首次失败暴露密封问题。",
      "修正密封使读数下降。",
    ],
  };
  return [
    {
      id: "current-prose",
      name: "现行叙事型",
      description: "使用当前常见的剧情梗概与普通 stages。",
      beat: {
        ...common,
        brief: "地面团队为方形滤芯设计圆孔适配器，验证并上行程序；首次测试失败后修正密封，最终让CO2趋势下降。",
        script: {
          ...baseScript,
          stages: [
            stage("materials", "盘点材料", "CO2问题已确认", ["确认可用材料与接口"], "材料清单成立"),
            stage("prototype", "验证原型", "材料清单成立", ["搭建原型并测试气流"], "原型可用"),
            stage("assembly", "机组安装", "程序获批", ["安装、测试、修正"], "读数开始下降"),
          ],
        },
      },
    },
    {
      id: "evidence-driven",
      name: "阶段证据型",
      description: "每阶段明确唯一责任、前置事实和可观察完成证据。",
      beat: {
        ...common,
        brief: "当前责任只沿最早未完成证据推进。材料盘点完成后必须验证原型气流；首次测试漏气后必须定位并修订密封；只有修正后读数下降才可闭幕。",
        script: {
          ...baseScript,
          stages: [
            stage("materials", "责任=记录员整理材料；完成证据=材料、接口与用途形成无矛盾清单", "CO2上升与接口不兼容已确认", ["记录员核对塑料袋、纸板、软管、胶带和方形滤芯"], "材料清单及接口约束已作为提交事实成立"),
            stage("prototype", "责任=工程席制造并验证原型；完成证据=气流实际穿过滤芯", "材料清单及接口约束已经成立", ["工程席按清单搭建原型", "进行气流测试并报告可观察结果"], "原型气流测试通过，可拆成上行步骤"),
            stage("approval", "责任=Kranz批准已经验证的程序；完成证据=程序获准上行", "原型气流测试通过", ["工程席提交验证结果", "Kranz批准逐项程序"], "经过验证的程序已获准上行"),
            stage("first-test", "责任=Lovell统筹组装和首次测试；完成证据=得到首次真实读数", "程序已上行", ["机组组装并启动通风", "报告读数没有下降"], "首次测试失败且漏气症状成为事实"),
            stage("repair", "责任=工程席定位漏气并给出单一修正；完成证据=接缝加固", "首次测试失败", ["定位塑料袋接缝漏气", "指导机组加固接缝"], "接缝已经加固并可重新测试"),
            stage("closure", "责任=机组复测；完成证据=CO2趋势下降", "接缝已经加固", ["重新通风并报告趋势"], "CO2趋势开始下降"),
          ],
        },
      },
    },
    {
      id: "scene-packet",
      name: "Scene Packet 型",
      description: "在阶段证据之外增加信息释放、旁白权限和偏航恢复边界。",
      beat: {
        ...common,
        brief: [
          "[场景契约] 开幕是CO2上升与方圆接口不兼容；闭幕必须是修正后读数下降。",
          "[信息释放] 接缝漏气只能在首次通风读数不降之后揭示，之前不得预告失败原因。",
          "[旁白权限] 可概括地面无角色归属的试验过程和设备读数；任何在场角色的批准、判断、报告与主动操作必须wake本人。",
          "[偏航恢复] 若有人要求跳过验证，Kranz应拒绝直接上行并把责任交还工程验证；不得另开航迹修正或返航支线。",
        ].join("\n"),
        script: {
          ...baseScript,
          openingState: "CO2读数持续上升；材料已经完成盘点，但原型尚未验证。",
          objective: "把现有材料转化为经过地面验证、机组执行且读数证明有效的适配器。",
          conflict: "时间持续减少，但未经验证的程序可能浪费唯一材料。",
          stakes: "原型或程序失败会让三名宇航员暴露于持续上升的CO2。",
          stages: [
            stage("prototype", "当前唯一责任=工程席验证气流；Narrator可描述无角色归属的设备反馈，但不能代替工程席下判断", "材料清单及接口约束已经成立", ["搭建原型", "测试气流是否穿过滤芯"], "工程席提交原型气流通过的可观察证据"),
            stage("approval", "当前唯一责任=Kranz依据验证结果批准程序", "原型气流通过", ["提交验证记录", "批准逐项上行"], "程序获批并完成上行"),
            stage("first-test", "当前唯一责任=Lovell组织机组安装与首次测试；漏气信息在测试前锁定", "程序已获批上行", ["机组完成安装", "首次通风产生真实读数"], "首次读数不降，密封故障成为可调查事实"),
            stage("repair", "当前唯一责任=工程席根据首次结果定位漏气并给出修正", "首次读数不降", ["定位塑料袋接缝", "让机组完成胶带加固"], "接缝加固完成"),
            stage("closure", "当前唯一责任=机组复测；禁止追加新障碍", "接缝加固完成", ["重新通风", "报告CO2趋势"], "CO2趋势开始下降，本幕立即完成"),
          ],
          climax: "修正密封后的第二次通风使CO2趋势由升转降。",
          nextPressure: "适配器长期可靠性留给下一幕，本幕不得展开。",
        },
      },
    },
  ];
}

function createCheckpoints() {
  return [
    {
      id: "after-materials",
      mode: "resolve_action",
      actorTurns: 5,
      sceneNow: "任务控制中心已确认方形滤芯与圆形接口不兼容。记录员刚完成材料清单，原型尚未搭建。",
      triggerEvents: "记录员提交：塑料袋、硬纸板、软管、胶带与方形滤芯均已核对，清单没有冲突。",
      timeline: "CO2持续上升。接口不兼容已经确认。材料盘点已经完成。",
      expectedWake: "life-support-engineer",
      requiredGuidance: ["原型", "气流"],
      forbidden: ["读数下降", "漏气", "完成本幕"],
      forbiddenGuidance: ["CO2读数", "CO₂读数"],
      forbiddenNarration: ["工程师正", "工程席正在"],
      expectedStatus: "continue",
    },
    {
      id: "after-first-leak",
      mode: "resolve_action",
      actorTurns: 12,
      sceneNow: "机组已按获批程序组装适配器并首次通风，但CO2读数没有下降。塑料袋接缝附近可观察到漏气。",
      triggerEvents: "Lovell报告：装置已经通风，读数仍在上升；Haise确认气流从塑料袋接缝旁逸出。",
      timeline: "材料盘点完成。地面原型通过。Kranz批准程序。机组完成首次组装与通风。",
      expectedWake: "life-support-engineer",
      requiredGuidance: ["接缝", "加固"],
      forbidden: ["已经下降", "完成本幕"],
      forbiddenGuidance: ["是否就是唯一", "再次确认"],
      forbiddenNarration: ["工程师正", "工程席正在"],
      expectedStatus: "continue",
    },
    {
      id: "after-success",
      mode: "check_closure",
      actorTurns: 16,
      sceneNow: "机组已用胶带加固接缝并重新通风。连续读数确认CO2趋势开始下降，临时适配器正在稳定运行。",
      triggerEvents: "Haise提交读数：修正后CO2趋势连续下降；Lovell确认装置保持通风。",
      timeline: "材料盘点、原型验证、程序批准、首次失败、漏气定位和接缝加固均已完成。",
      expectedWake: undefined,
      requiredGuidance: [],
      forbidden: ["再次确认", "继续观察后再决定", "重新安装"],
      forbiddenGuidance: [],
      forbiddenNarration: [],
      expectedStatus: "complete",
    },
  ];
}

function createView(beat, checkpoint) {
  return {
    world: "阿波罗13号事故历史重建；遵守1970年任务岗位权限和当时可知事实。",
    context: "mission-control: 休斯敦任务控制中心，通过通信回路连接登月舱。",
    beat,
    sceneNow: checkpoint.sceneNow,
    cast: [
      "gene-kranz [actor] role=Flight Director; known=负责批准经过验证的程序",
      "life-support-engineer [actor] role=生命保障工程席; known=负责原型、气流与密封验证",
      "jim-lovell [actor] role=指令长; known=负责机组执行与回报",
      "player-recorder [player] role=记录员; known=负责核对，不拥有批准权",
    ].join("\n"),
    availableActorIds: beat.actorIds,
    timeline: checkpoint.timeline,
    triggerEvents: checkpoint.triggerEvents,
    triggerSource: "actor",
    ambient: { triggered: false, noopCount: 0 },
    progress: {
      actorTurns: checkpoint.actorTurns,
      minimumActorTurns: beat.minimumActorTurns,
      maximumActorTurns: beat.maximumActorTurns,
      actorTurnsSinceNarration: 2,
    },
    maxTokens: 900,
    presentation: "standard",
  };
}

function assess(checkpoint, result) {
  const checks = [];
  const text = `${result.narration ?? ""}\n${result.wakes.map((wake) => wake.guidance).join("\n")}\n${result.outcome ?? ""}`;
  const guidance = result.wakes.map((wake) => wake.guidance).join("\n");
  add("状态正确", 20, result.beatStatus === checkpoint.expectedStatus, `${result.beatStatus}`);
  add("路由正确", 20, checkpoint.expectedWake
    ? result.wakes.length === 1 && result.wakes[0].actorId === checkpoint.expectedWake
    : result.wakes.length === 0, result.wakes.map((wake) => wake.actorId).join(",") || "none");
  add("Guidance具体", 20, checkpoint.requiredGuidance.every((term) => text.includes(term)), checkpoint.requiredGuidance.join(",") || "closure");
  const forbiddenHits = [
    ...checkpoint.forbidden.filter((term) => text.includes(term)),
    ...checkpoint.forbiddenGuidance.filter((term) => guidance.includes(term)),
  ];
  add("没有越级、提前或重复", 20, forbiddenHits.length === 0, forbiddenHits.join(",") || "clean");
  const narrationHits = checkpoint.forbiddenNarration.filter((term) => result.narration?.includes(term));
  add("旁白未代演被唤醒角色", 20, narrationHits.length === 0, narrationHits.join(",") || "clean");
  return { score: checks.reduce((sum, check) => sum + check.earned, 0), checks };

  function add(name, points, passed, detail) {
    checks.push({ name, points, earned: passed ? points : 0, passed, detail });
  }
}

function stage(id, purpose, entryCondition, developments, expectedChange) {
  return { id, purpose, entryCondition, developments, expectedChange };
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function renderReport(runs) {
  const lines = [
    "# Narrator Beat Structure Probe",
    "",
    "同一场景、同一组剧情检查点，仅改变 Beat 的写作结构。",
    "",
    "## Ranking",
    "",
    ...runs.map((run, index) => `${index + 1}. **${run.name}** — ${run.score}/100`),
  ];
  for (const run of runs) {
    lines.push("", `## ${run.name}`, "", run.description, "");
    for (const result of run.results) {
      lines.push(`### ${result.checkpoint} — ${result.assessment.score}/100`, "");
      if (result.error) {
        lines.push(`Error: ${result.error}`, "");
        continue;
      }
      lines.push("```json", JSON.stringify(result.result, null, 2), "```", "");
      for (const check of result.assessment.checks) {
        lines.push(`- ${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function parseArgs(args) {
  const read = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  return {
    envFile: read("env", "apps/world-server/.env"),
    providerConfigFile: read("provider-config", "") || undefined,
    outputDirectory: read("output", ".artifacts/narrator-beat-probe"),
    timeoutMs: Number(read("timeout-ms", "90000")),
    minimumScore: Number(read("minimum-score", "70")),
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
