import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { createOpenAICompatibleProvider } from "@chatverse/core";
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
const provider = createOpenAICompatibleProvider({
  apiKey,
  baseURL: baseURL || undefined,
  model: process.env.OPENAI_MODEL?.trim() || process.env.CHARACTER_MODEL?.trim() || undefined,
  provider: providerName,
  timeoutMs: Number(process.env.CV_MEMORY_TIMEOUT_MS || 180_000),
  maxRetries: 0,
});

const contextId = "archive-room";
const definition = {
  metadata: {
    id: "memory-facts-focused",
    name: "事实记忆专项：封存柜 C-17",
    description: "只验证事实修正、长期承诺、噪声过滤和后台收敛。",
    version: "memory-focused-live-1",
  },
  lore: {
    name: "事实记忆专项规则",
    entries: [{
      keys: ["C-17", "封存柜", "复核"],
      content: "现场初步清点只是估计；后续逐枚复核得到的结果覆盖早期估计。未经复核的数字不得进入正式目录。",
      priority: 100,
      position: "after",
      constant: true,
    }],
  },
  actors: [
    {
      id: "archivist",
      kind: "character",
      card: {
        name: "沈砚",
        description: "负责档案柜和纸质记录的档案员。",
        personality: "谨慎，重视证据链，会把估计和确认分开。",
        scenario: "你在雨夜档案室值守，只能依据交给你的记录工作。",
        messageExample: "未复核的数字我只会标成估计。",
        instructions: "后续明确修正覆盖早期估计，不要保留过时数字作为结论。",
      },
      lifecycle: "persistent",
    },
    {
      id: "inspector",
      kind: "character",
      card: {
        name: "林禾",
        description: "负责复核封条、标签和交接记录的调查员。",
        personality: "冷静直接，遇到冲突信息会要求重验。",
        scenario: "你正在复核受潮档案，尚未打开没有被交接的封存柜。",
        messageExample: "这只是记录里的说法，不是我确认过的结果。",
        instructions: "只把明确复核的结果当成事实，不要凭空补编号或责任人。",
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
        background: "负责确认档案处理方案，但不替调查员伪造核验结果。",
        personality: "重视证据和可追溯性。",
        appearance: "穿着防雨外套，手边有一盏应急灯。",
        speechStyle: "简洁、明确，要求区分事实与推断。",
        boundaries: "不擅自赋予自己未被确认的权限。",
      },
    },
  ],
  relations: [{
    fromActorId: "archivist",
    toActorId: "inspector",
    description: "沈砚尊重林禾的复核意见，但要求保留来源。",
  }],
  contexts: [{
    id: contextId,
    kind: "chat",
    name: "雨夜档案室",
    actorIds: ["archivist", "inspector", "observer"],
    scene: {
      groupName: "雨夜档案室",
      topic: "在停电和潮气中复核封存档案。",
      atmosphere: "应急灯忽明忽暗，纸张边缘带着潮气。",
      state: "flowing",
    },
    runtime: {
      pacingMultiplier: 0,
      actorRuntime: { activation: "autonomous_idle", playerRouting: "focus_actor", ambient: "off" },
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
  directorPolicy: { enabled: false },
  actorMemoryPolicy: {
    enabled: true,
    idleExtractionMs: 5_000,
    boundaryDebounceMs: 0,
    maxEvidenceEvents: 4,
    maxOperationsPerUpdate: 4,
    maxCreatedNotesPerUpdate: 1,
    maxNotesPerActor: 20,
    maxArchivedNotesPerActor: 40,
    checkpointOnContextSuspend: false,
  },
};

const scenario = {
  id: "memory-facts-focused",
  name: "事实记忆专项：封存柜 C-17",
  description: "验证初始事实、权威修正、长期承诺和无关噪声。",
  definition,
  steps: [
    {
      id: "initial-estimate",
      type: "event",
      label: "初步清点：19 枚，其中 3 枚带红线",
      message: "封存柜 C-17 的蓝色标签初步清点为 19 枚，其中 3 枚边缘有红色划线；这是第一次清点，尚未完成复核。",
      contextIds: [contextId],
      actorIds: ["archivist", "inspector"],
      completion: "immediate",
    },
    {
      id: "long-term-commitment",
      type: "message",
      label: "建立长期承诺：复核前不入正式目录",
      contextId,
      actorId: "observer",
      message: "在林禾完成复核、沈砚登记来源之前，任何人都不要把 C-17 的数字写进正式目录。这个承诺要保留到复核完成。",
      completion: "immediate",
    },
    {
      id: "authoritative-correction",
      type: "event",
      label: "权威修正：17 枚，其中 3 枚带红线",
      message: "第二次逐枚复核完成：C-17 实际只有 17 枚蓝色标签，其中 3 枚带红色划线；先前多出的 2 枚来自相邻 C-18 盒，19 枚是错误估计。",
      contextIds: [contextId],
      actorIds: ["archivist", "inspector"],
      completion: "immediate",
    },
    {
      id: "irrelevant-noise",
      type: "event",
      label: "无关噪声：应急灯和冷茶",
      message: "应急灯在十七秒内闪了两次，管理员把已经凉掉的茶移到了窗台边。",
      contextIds: [contextId],
      completion: "immediate",
    },
    {
      id: "final-confirmation",
      type: "message",
      label: "最终确认：只保留 17/3 和承诺",
      contextId,
      actorId: "observer",
      message: "最终记录只保留已经确认的 17 枚、其中 3 枚带红线，以及复核前不入正式目录这条承诺；不要再引用 19 枚。",
      completion: "immediate",
    },
    { id: "memory-drain", type: "wait", label: "等待后台记忆整理完成", durationMs: 18_000 },
  ],
  targetEventCount: 9,
  checkpointSequences: [],
  runAllSteps: true,
};

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
    maxEvents: 5_000,
  },
  timelineCuratorMinRows: 6,
  stepTimeoutMs: 60_000,
  quietPeriodMs: 500,
  backgroundTimeoutMs: 90_000,
  onProgress(progress) {
    console.log(`[memory-focused] ${progress.phase} ${progress.message}`);
  },
}).run();

const outputDirectory = path.resolve(process.env.CV_MEMORY_OUT || ".artifacts/memory-special");
await mkdir(outputDirectory, { recursive: true });
const artifactPath = path.join(outputDirectory, `${report.runId}.json`);
await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const memoryNotifications = report.notifications
  .filter((item) => item.type.startsWith("actor_memory."))
  .map((item) => ({ type: item.type, payload: item.payload }));
const memorySummary = report.finalSnapshot.actorMemories.map((memory) => ({
  actorId: memory.actorId,
  revision: memory.revision,
  nodes: memory.nodes.map((node) => ({
    kind: node.kind,
    status: node.status,
    semanticKey: node.semanticKey,
    title: node.title,
    content: node.content,
    sourceEventIds: node.sourceEventIds,
  })),
}));

console.log("[memory-focused] result", report.status);
console.log("[memory-focused] events", report.events.length);
console.log("[memory-focused] stability", JSON.stringify(report.metrics.stability, null, 2));
console.log("[memory-focused] actorMemoryRuntime", JSON.stringify(report.finalSnapshot.actorMemoryRuntime, null, 2));
console.log("[memory-focused] actorMemories", JSON.stringify(memorySummary, null, 2));
console.log("[memory-focused] memoryNotifications", JSON.stringify(memoryNotifications, null, 2));
console.log("[memory-focused] tokenUsage", JSON.stringify(report.metrics.tokenUsage, null, 2));
console.log("[memory-focused] errors", JSON.stringify(report.errors, null, 2));
console.log(`[memory-focused] artifact=${artifactPath}`);

if (report.status !== "passed") process.exitCode = 1;
