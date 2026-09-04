import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import {
  InProcessRuntimeHost,
  World,
  createOpenAICompatibleProvider,
} from "@chatverse/core";

const WORLD_ID = "real-narrator-spawn-check";
const CONTEXT_ID = "mountain-pass";
const PLAYER_ID = "player";
const DEADLINE_MS = 180_000;

loadLocalEnv();

const apiKey = process.env.OPENAI_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) {
  throw new Error("未找到 OPENAI_API_KEY 或 DEEPSEEK_API_KEY，无法运行真实场景。");
}

const baseURL = process.env.OPENAI_BASE_URL?.trim() || process.env.DEEPSEEK_BASE_URL?.trim();
const providerName = baseURL?.toLowerCase().includes("deepseek") ? "deepseek" : "openai-compatible";
const sharedModel = process.env.OPENAI_MODEL?.trim();
const provider = createOpenAICompatibleProvider({
  apiKey,
  baseURL: baseURL || undefined,
  provider: providerName,
  model: sharedModel || process.env.CHARACTER_MODEL?.trim() || undefined,
  timeoutMs: 90_000,
  maxRetries: 0,
});

const world = new World(
  createDefinition(),
  provider,
  provider,
  new InProcessRuntimeHost(),
  {
    debug: { enabled: true, maxEvents: 2_000 },
  },
);

const notifications = [];
const events = [];
const usage = [];
const startedAt = Date.now();
let playerMessageSent = false;
let playerMessageCommitted = false;
let playerEventSequence;
let supportObserved = false;
let dynamicActorObserved = false;
let runError;
let progressTimer;

world.onNotification((notification) => {
  notifications.push({
    type: notification.type,
    sequence: notification.sequence,
    payload: notification.payload,
  });
  if ([
    "narrator.director_requested",
    "director.support_started",
    "director.support_completed",
    "director.support_declined",
    "director.error",
    "narrator.error",
  ].includes(notification.type)) {
    console.log(`[notify] ${notification.type} ${compact(notification.payload)}`);
  }
  if (notification.type === "narrator.director_requested" && playerMessageCommitted) supportObserved = true;
});

world.onEvent((event) => {
  events.push({
    id: event.id,
    sequence: event.sequence,
    type: event.type,
    actorId: event.actorId,
    contextId: event.contextId,
    payload: event.payload,
  });
  if (event.type === "context.message.committed" && event.actorId === PLAYER_ID) {
    playerMessageCommitted = true;
    playerEventSequence = event.sequence;
  }
});

world.onProviderUsage((observation) => {
  usage.push({
    role: observation.role,
    purpose: observation.purpose,
    inputTokens: observation.usage.inputTokens,
    outputTokens: observation.usage.outputTokens,
    totalTokens: observation.usage.totalTokens,
    cacheHitInputTokens: observation.usage.cacheHitInputTokens,
  });
});

try {
  world.start();
  world.requestProgression({ contextId: CONTEXT_ID, reason: "bootstrap" });
  console.log(`[run] provider=${providerName} model=${sharedModel || process.env.CHARACTER_MODEL?.trim() || "provider-default"}`);
  console.log("[run] 已请求开场，等待当前 Beat 建立并由 Narrator 接管。");

  await waitUntil(() => world.snapshot().narrative.beats.some((beat) => beat.status === "running"), 120_000);
  // Send the player turn as soon as the Beat is committed, before the
  // opening Narrator/Actor chain can consume the whole test window.
  await waitUntil(() => events.some((event) => event.type === "narrative.beat.recorded"), 120_000);

  world.sendMessage({
    contextId: CONTEXT_ID,
    actorId: PLAYER_ID,
    message: "我不想让你们继续猜。山路东侧有一串刚留下的车辙，现有的人都没有亲眼核实过。我建议请一个真正走过东侧山路、能提供一手线索的人到场；不要替他预设忠诚或答案，让他只说自己看见的东西。",
  });
  playerMessageSent = true;
  console.log("[run] 玩家已提出引入一名不在场的东侧山路知情者，等待 Narrator 是否请求幕内支援。");
  await waitUntil(() => playerMessageCommitted, 120_000);
  console.log("[run] 玩家消息已进入正式 WorldEvent，开始等待 Narrator 仲裁。");
  progressTimer = setInterval(() => {
    const snapshot = world.snapshot();
    const counts = countByType(notifications);
    console.log(`[progress] events=${snapshot.events.length} beats=${snapshot.narrative.beats.length} ` +
      `narrator=${counts["narrator.completed"] ?? 0} support=${counts["narrator.director_requested"] ?? 0} ` +
      `dynamic=${snapshot.dynamicActors?.length ?? 0}`);
  }, 20_000);

  await waitUntil(() => {
    const snapshot = world.snapshot();
    const spawnedAfterPlayer = snapshot.events.some((event) => (
      event.type === "actor.registered" &&
      playerEventSequence !== undefined &&
      event.sequence > playerEventSequence
    ));
    const dynamic = snapshot.dynamicActors ?? [];
    dynamicActorObserved = spawnedAfterPlayer && dynamic.length > 0;
    return supportObserved || dynamicActorObserved;
  }, DEADLINE_MS);

  if (dynamicActorObserved) {
    await waitUntil(() => {
      const snapshot = world.snapshot();
      const dynamicIds = new Set((snapshot.dynamicActors ?? []).map((actor) => actor.id));
      return snapshot.events.some((event) => (
        event.type === "context.message.committed" &&
        event.actorId &&
        dynamicIds.has(event.actorId)
      ));
    }, 60_000).catch(() => {});
  }
} catch (error) {
  runError = error instanceof Error ? error.message : String(error);
} finally {
  if (progressTimer) clearInterval(progressTimer);
  world.stop();
}

const snapshot = world.snapshot();
const actors = new Map(world.getRegisteredActors().map((actor) => [actor.id, actor.card.name]));
const spawnedAfterPlayerIds = new Set(events
  .filter((event) => event.type === "actor.registered" && playerEventSequence !== undefined && event.sequence > playerEventSequence)
  .map((event) => event.actorId)
  .filter(Boolean));
const dynamicActors = (snapshot.dynamicActors ?? [])
  .filter((actor) => spawnedAfterPlayerIds.has(actor.id))
  .map((actor) => ({
  id: actor.id,
  name: actor.card.name,
  lifecycle: actor.lifecycle,
  }));
const messages = world.getContextMessages(CONTEXT_ID).map((message) => ({
  actorName: message.characterName,
  speaker: actors.get(message.characterName) ?? message.characterName,
  content: message.message,
}));
const relevantNotifications = notifications.filter((item) => [
  "narrator.director_requested",
  "director.support_started",
  "director.support_completed",
  "director.support_declined",
  "narrator.error",
  "director.error",
].includes(item.type));
const tokenTotals = usage.reduce((total, item) => ({
  inputTokens: total.inputTokens + item.inputTokens,
  outputTokens: total.outputTokens + item.outputTokens,
  totalTokens: total.totalTokens + item.totalTokens,
  cacheHitInputTokens: total.cacheHitInputTokens + item.cacheHitInputTokens,
}), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheHitInputTokens: 0 });
const dynamicNames = new Set(dynamicActors.map((actor) => actor.name));
const dynamicMessageEntries = messages.filter((message) => dynamicNames.has(message.actorName));
const result = {
  schemaVersion: 1,
  worldId: WORLD_ID,
  provider: providerName,
  playerMessageSent,
  playerMessageCommitted,
  supportObserved,
  dynamicActorObserved,
  runError,
  dynamicActors,
  dynamicMessageEntries,
  relevantNotifications,
  beatCount: snapshot.narrative.beats.length,
  eventCount: snapshot.events.length,
  messageCount: messages.length,
  notificationTypeCounts: countByType(notifications),
  eventTypeCounts: countByType(events),
  messages,
  recentEvents: events.slice(-16).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    actorId: event.actorId,
    contextId: event.contextId,
  })),
  tokenTotals,
  elapsedMs: Date.now() - startedAt,
};

const outputDirectory = resolve(".artifacts/real-narrator-spawn");
mkdirSync(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `run-${Date.now()}.json`);
writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");

console.log("");
console.log("=== Real Narrator Spawn Check ===");
console.log(`supportRequested=${supportObserved} dynamicActor=${dynamicActorObserved} dynamicMessages=${dynamicMessageEntries.length}`);
console.log(`playerCommitted=${playerMessageCommitted} beats=${result.beatCount} events=${result.eventCount} messages=${result.messageCount} tokens=${tokenTotals.totalTokens}`);
if (runError) console.log(`runError=${runError}`);
console.log(`artifact=${outputPath}`);
if (dynamicActors.length) console.log(`actors=${dynamicActors.map((actor) => actor.name).join(", ")}`);
if (dynamicMessageEntries.length) {
  for (const entry of dynamicMessageEntries) console.log(`[dynamic] ${entry.speaker}: ${entry.content}`);
}

function createDefinition() {
  return {
    metadata: {
      id: WORLD_ID,
      name: "真实 Narrator 幕内引入测试",
      description: "测试玩家在进行中的 Beat 内请求一名不在场的线索人物。",
    },
    lore: {
      name: "山路资料",
      entries: [
        {
          keys: ["车辙", "东侧", "巡山"],
          content: "东侧山路平时只有本地巡山人熟悉；当前在场的石亭抄录员和过路医者都没有走过东侧，也没有亲眼核实车辙来源。任何人都只能陈述自己亲眼观察到的事实。",
          priority: 5,
          position: "before",
          constant: true,
        },
      ],
    },
    actors: [
      {
        id: "scribe",
        kind: "character",
        card: {
          name: "石亭抄录员",
          description: "临时在石亭整理过路文书的抄录员，从未走过东侧山路。",
          personality: "谨慎、话少，不愿替别人确认自己没看见的事。",
          scenario: "正在石亭旁整理文书，只看见西侧入口，没去过东侧山路。",
          messageExample: "我只说亲眼看见的，猜的不能当凭据。",
          instructions: "优先处理玩家最新表达；明确说明自己没有走过东侧山路，不要假装掌握东侧车辙的一手信息。",
        },
      },
      {
        id: "traveler",
        kind: "character",
        card: {
          name: "过路医者",
          description: "暂时借宿山口的过路医者。",
          personality: "温和但观察敏锐，遇到不确定的事先保留判断。",
          scenario: "在旧石亭内整理药包，能听见山道动静。",
          messageExample: "这只是我的推测，若要确认还得问走过那条路的人。",
          instructions: "不替石亭抄录员提供未观察到的细节，不把推测说成事实。",
        },
      },
      {
        id: PLAYER_ID,
        kind: "character",
        playerControlled: true,
        card: {
          name: "穿越者", description: "来自异世的旁观者，能提出建议但没有本地职权。",
          personality: "重视证据，不喜欢凭空猜测。", scenario: "暂时落脚山口。", messageExample: ""
        },
        playerCard: {
          name: "穿越者",
          identity: "来自异世、暂时落脚山口的普通人",
          background: "知道一些零散的常识，但不了解本地势力与山路详情。",
          personality: "重视证据，不喜欢凭空猜测。",
          appearance: "穿着与当地略有不同的便装。",
          speechStyle: "直接、清楚，提出建议时说明依据。",
          boundaries: "没有军权、法术或本地身份，不得替当地人宣布事实。",
        },
      },
    ],
    contexts: [
      {
        id: CONTEXT_ID,
        kind: "chat",
        name: "山口石亭",
        actorIds: ["scribe", "traveler", PLAYER_ID],
        scene: {
          groupName: "山口石亭",
          topic: "东侧山路出现不明车辙",
          atmosphere: "傍晚，山风变冷，石亭外看不清远处山路。",
          state: "flowing",
          rules: ["角色只说自己知道、观察到或明确推测的内容。", "临时角色要有现场缘由，不能凭空降临。", "当前在场角色都没有走过东侧山路；玩家要求东侧一手目击时，不能让在场者代答。"],
        },
        lore: {
          entries: [
            {
              keys: ["车辙", "东侧山路", "线索"],
              content: "东侧车辙尚未由任何在场角色亲眼核实；石亭抄录员和过路医者不能代答自己没有观察到的内容。",
              priority: 8,
              position: "before",
              constant: true,
            },
          ],
        },
        runtime: {
          pacingMultiplier: 0.35,
          actorRuntime: { activation: "beat_runtime", playerRouting: "narrator", ambient: "off" },
          beatRuntime: { narratorMaxTokens: 900, actorMaxTokens: 700, playerMaxTokens: 600, maxAttemptsPerTurn: 2 },
          messageStyle: { maxBurstCount: 2, allowStickers: false, preferShortMessages: true },
        },
        initiallyActive: false,
      },
    ],
    relations: [],
    chapters: [
      {
        id: "chapter-east-road",
        title: "东侧山路的来者",
        treatment: "东侧山路留下了新车辙，但现场没有任何角色亲眼确认来者。记录员、旅人和访客需要在有限线索中逐步核对方向、时间和可见痕迹；任何身份、伤势或组织归属都只能在获得来源后成立。章节通过多场 Beat 把调查从模糊猜测推进到一项可执行的核查安排，过程中的不确定性和角色权限必须保持清楚。",
        targetOutcome: "在证据边界内确认东侧山路的下一步核查方式，并保留对来者身份的合理不确定性。",
        status: "active",
        actorIds: ["scribe", "traveler", PLAYER_ID],
        contextIds: [CONTEXT_ID],
      },
    ],
    directorPolicy: {
      enabled: true,
      batchSize: 1,
      debounceMs: 0,
      minIntervalMs: 0,
      maxBatchSize: 12,
      maxToolRounds: 2,
      narratorDebounceMs: 100,
      maxProviderRetries: 1,
      contextSuspendAfterMs: 600_000,
      actorBackgroundMinEvents: 999,
      actorAuthority: "coordinate",
    },
    actorMemoryPolicy: { enabled: false },
  };
}

function loadLocalEnv() {
  const path = resolve("apps/world-server/.env");
  if (!existsSync(path)) return;
  try {
    loadEnvFile(path);
  } catch (error) {
    throw new Error(`无法加载环境文件：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`等待真实运行结果超时（${timeoutMs}ms）。`);
}

function compact(value) {
  return JSON.stringify(value, (_, item) => typeof item === "string" && item.length > 180 ? `${item.slice(0, 177)}...` : item);
}

function countByType(items) {
  return items.reduce((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {});
}
