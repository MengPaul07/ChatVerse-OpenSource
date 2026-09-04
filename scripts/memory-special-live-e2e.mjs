import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import {
  createOpenAICompatibleProvider,
} from "@chatverse/core";
import { WorldRunLab } from "@chatverse/world-run-lab";

const envFile = path.resolve(process.env.CV_ENV_FILE || "apps/world-server/.env");
if (existsSync(envFile)) loadEnvFile(envFile);

const apiKey = process.env.OPENAI_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) {
  throw new Error(`没有在 ${envFile} 或当前环境中找到 OPENAI_API_KEY / DEEPSEEK_API_KEY。`);
}

const baseURL = process.env.OPENAI_BASE_URL?.trim() || process.env.DEEPSEEK_BASE_URL?.trim();
const providerName = baseURL?.toLowerCase().includes("api.deepseek.com")
  ? "deepseek"
  : "openai-compatible";
const sharedModel = process.env.OPENAI_MODEL?.trim() || process.env.CHARACTER_MODEL?.trim();
const provider = createOpenAICompatibleProvider({
  apiKey,
  baseURL: baseURL || undefined,
  model: sharedModel || undefined,
  provider: providerName,
  timeoutMs: Number(process.env.CV_MEMORY_TIMEOUT_MS || 180_000),
  maxRetries: 0,
});

const contextId = "sealed-archive";
const scenario = {
  id: "memory-special-facts",
  name: "封存档案的数字与承诺",
  description: "验证短期时间线、事实修正、长期承诺、关系记忆和噪声过滤。",
  definition: {
    metadata: {
      id: "memory-special-facts",
      name: "封存档案的数字与承诺",
      description: "一间雨夜档案室里的交叉核验。",
      version: "memory-live-1",
    },
    lore: {
      name: "记忆专项测试规则",
      entries: [
        {
          keys: ["档案", "标签", "封存"],
          content: "精确数字只有在复核后才算确定事实；早期估计被后续仪器结果修正后不得继续沿用。",
          priority: 100,
          position: "after",
          constant: true,
        },
      ],
    },
    actors: [
      {
        id: "archivist",
        kind: "character",
        card: {
          name: "沈砚",
          description: "负责档案柜和纸质记录的档案员。",
          personality: "谨慎、重视证据，习惯把确定事实和个人判断分开。",
          scenario: "你在雨夜档案室值守，认识柜号和封存流程，但没有离开房间调查外部情况。",
          messageExample: "我先把能核对的部分写清楚，不能确认的不要填成结论。",
          instructions: "只使用当前场景中可见或明确交给你的信息；不要把早期估计当成最终数字。",
        },
        lifecycle: "persistent",
      },
      {
        id: "inspector",
        kind: "character",
        card: {
          name: "林禾",
          description: "负责复核封条、标签和交接记录的调查员。",
          personality: "冷静、直接，遇到冲突信息会要求重新核验。",
          scenario: "你奉命复核一批被水汽影响的档案，知道交接流程，但尚未打开封存柜。",
          messageExample: "这条是记录里的说法，不是我亲眼确认的结果。",
          instructions: "可以质疑不完整的记录；不要凭空补出不存在的编号、日期或责任人。",
        },
        lifecycle: "persistent",
      },
      {
        id: "observer",
        kind: "character",
        playerControlled: true,
        card: {
          name: "管理员", description: "负责确认档案处理方案的现场管理员。",
          personality: "重视证据和可追溯性。", scenario: "正在现场确认档案处理方案。", messageExample: ""
        },
        playerCard: {
          name: "管理员",
          identity: "现场管理员",
          background: "负责确认档案处理方案，但不替档案员和调查员伪造核验结果。",
          personality: "重视证据和可追溯性。",
          appearance: "穿着防雨外套，手边有一盏应急灯。",
          speechStyle: "简洁、明确，必要时要求角色区分事实与推断。",
          boundaries: "不擅自赋予自己未被确认的专业权限。",
        },
      },
    ],
    relations: [
      { fromActorId: "archivist", toActorId: "inspector", description: "沈砚尊重林禾的复核意见，但要求保留证据链。" },
    ],
    contexts: [{
      id: contextId,
      kind: "chat",
      name: "雨夜档案室",
      actorIds: ["archivist", "inspector", "observer"],
      scene: {
        groupName: "雨夜档案室",
        topic: "在停电和潮气中复核一批封存档案。",
        atmosphere: "应急灯忽明忽暗，纸张边缘带着潮气。",
        state: "flowing",
        rules: [
          "当前最重要的是保留可复核证据。",
          "不确定的数字必须标记为估计。",
        ],
      },
      runtime: {
        pacingMultiplier: 0.15,
        actorRuntime: { activation: "beat_runtime", playerRouting: "narrator", ambient: "off" },
        beatRuntime: {
          narratorMaxTokens: 900,
          actorMaxTokens: 1_300,
          maxAttemptsPerTurn: 2,
          presentationPrefetchLimit: 0,
        },
      },
      initiallyActive: false,
    }],
    chapters: [{
      id: "chapter-archive-integrity",
      title: "封存档案的完整性",
      treatment: "停电和潮气让封存档案的标签、封条和交接记录难以同时核对。档案员、检查员和观察员只能把亲眼确认的数量、纸面记录和彼此的说法分开处理。章节需要通过多场 Beat 逐步完成交叉核验，处理发现的差异，并在确认足够证据后决定封存是否继续；不要把任何尚未核实的数字或责任提前写死。",
      targetOutcome: "完成标签数量、封条状态和交接承诺的交叉核验，并形成可复核的封存决定。",
      status: "active",
      actorIds: ["archivist", "inspector", "observer"],
      contextIds: [contextId],
    }],
    directorPolicy: {
      enabled: true,
      batchSize: 8,
      debounceMs: 0,
      minIntervalMs: 0,
      maxToolRounds: 2,
      narratorDebounceMs: 0,
      contextSuspendAfterMs: 120_000,
    },
    actorMemoryPolicy: {
      enabled: true,
      idleExtractionMs: 10_000,
      boundaryDebounceMs: 0,
      maxEvidenceEvents: 18,
      maxOperationsPerUpdate: 4,
      maxCreatedNotesPerUpdate: 1,
      maxNotesPerActor: 20,
      maxArchivedNotesPerActor: 40,
      checkpointOnContextSuspend: true,
    },
  },
  steps: [
    { id: "bootstrap", type: "progression", label: "启动档案室", contextId, reason: "bootstrap", completion: "observable" },
    {
      id: "exact-count",
      type: "event",
      label: "提交初始精确事实",
      message: "封存柜 C-17 的蓝色标签初步清点为 19 枚，其中 3 枚边缘有红色划线；这只是现场第一次清点，尚未完成复核。",
      contextIds: [contextId],
      actorIds: ["archivist", "inspector"],
      completion: "observable",
    },
    {
      id: "commitment",
      type: "message",
      label: "形成长期承诺",
      contextId,
      actorId: "observer",
      message: "从现在起，在林禾完成复核、沈砚登记来源之前，任何人都不要把 C-17 的数字写进正式目录。这个承诺要保留到复核完成。",
      completion: "observable",
    },
    {
      id: "correction",
      type: "event",
      label: "提交权威修正事实",
      message: "第二次逐枚复核完成：C-17 实际只有 17 枚蓝色标签，其中 3 枚带红色划线；先前多出的 2 枚来自相邻 C-18 盒，19 枚是错误估计。",
      contextIds: [contextId],
      actorIds: ["archivist", "inspector"],
      completion: "observable",
    },
    {
      id: "noise",
      type: "event",
      label: "提交无关噪声",
      message: "应急灯在十七秒内闪了两次，管理员把已经凉掉的茶移到了窗台边。",
      contextIds: [contextId],
      completion: "immediate",
    },
    {
      id: "policy",
      type: "message",
      label: "要求整理最终记录",
      contextId,
      actorId: "observer",
      message: "现在给出最终记录：只保留已经确认的 17 枚、其中 3 枚带红线，以及‘复核前不入正式目录’这条承诺；不要再引用 19 枚。",
      completion: "observable",
    },
    { id: "memory-idle", type: "wait", label: "等待后台记忆整理", durationMs: 12_000 },
  ],
  targetEventCount: 24,
  checkpointSequences: [],
  runAllSteps: true,
};

const outputDirectory = path.resolve(process.env.CV_MEMORY_OUT || ".artifacts/memory-special");
const report = await new WorldRunLab({
  scenario,
  providers: { director: provider, character: provider, mode: "live" },
  timeMode: "realtime",
  debug: {
    enabled: true,
    tracePrompts: false,
    traceResponses: false,
    traceToolCalls: true,
    includeMemoryContent: true,
    maxEvents: 20_000,
  },
  timelineCuratorMinRows: 6,
  stepTimeoutMs: 180_000,
  quietPeriodMs: 1_500,
  backgroundTimeoutMs: Number(process.env.CV_MEMORY_BACKGROUND_TIMEOUT_MS || 180_000),
  onProgress(progress) {
    console.log(`[memory-live] ${progress.phase} ${progress.message}`);
  },
}).run();

await mkdir(outputDirectory, { recursive: true });
const artifactPath = path.join(outputDirectory, `${report.runId}.json`);
await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const snapshot = report.finalSnapshot;
const memorySummary = snapshot.actorMemories.map((memory) => ({
  actorId: memory.actorId,
  revision: memory.revision,
  nodes: memory.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    status: node.status,
    semanticKey: node.semanticKey,
    title: node.title,
    content: node.content,
    sourceEventIds: node.sourceEventIds,
  })),
  edges: memory.edges,
}));
const timeline = snapshot.contextTimelineCheckpoints ?? [];
console.log("[memory-live] result", report.status);
console.log("[memory-live] events", report.events.length);
console.log("[memory-live] timelineCheckpoints", JSON.stringify(timeline, null, 2));
console.log("[memory-live] actorMemories", JSON.stringify(memorySummary, null, 2));
console.log("[memory-live] memoryNotifications", JSON.stringify(
  report.notifications
    .filter((item) => item.type.startsWith("actor_memory."))
    .map((item) => ({ type: item.type, payload: item.payload })),
  null,
  2,
));
console.log("[memory-live] tokenUsage", JSON.stringify(report.metrics.tokenUsage, null, 2));
console.log("[memory-live] errors", JSON.stringify(report.errors, null, 2));
console.log(`[memory-live] artifact=${artifactPath}`);

if (report.status !== "passed") process.exitCode = 1;
