import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.CHATVERSE_LOCAL_URL?.trim() || "http://127.0.0.1:8787";
const CONTEXT_ID = "east-road-lodge";
const PLAYER_ID = "player";
const startedAt = Date.now();
let roomId;
let playerSequence;
let result;

try {
  const health = await request("/healthz");
  if (!health.providerConfigured) throw new Error("本地服务没有配置真实 Provider。");

  const created = await request("/api/v1/worlds", {
    method: "POST",
    body: { source: { kind: "world_draft", draft: createDraft() } },
  });
  roomId = created.roomId;
  console.log(`[api] room=${roomId}`);

  await request(`/api/v1/worlds/${roomId}/start`, { method: "POST" });
  const beatArchive = await waitForArchive((archive) => (
    archive.snapshot.narrative.beats.some((beat) => beat.status === "running")
  ), 120_000, "首个 Beat");

  const prePlayerDynamicIds = new Set(beatArchive.snapshot.dynamicActors.map((actor) => actor.id));
  console.log(`[api] beat ready, initialDynamic=${prePlayerDynamicIds.size}`);

  await request(`/api/v1/worlds/${roomId}/messages`, {
    method: "POST",
    body: {
      contextId: CONTEXT_ID,
      actorId: PLAYER_ID,
      message: "先别让在场的人继续猜。你们两位都明确没走过东侧山路，我现在要找一名不在场、但刚从东侧回来的人亲自说明车辙；请让他到石亭来，只说亲眼看见的内容。",
    },
  });

  const playerArchive = await waitForArchive((archive) => {
    const event = archive.snapshot.events.find((candidate) => (
      candidate.type === "context.message.committed" && candidate.actorId === PLAYER_ID
    ));
    if (!event) return false;
    playerSequence = event.sequence;
    return true;
  }, 60_000, "玩家消息提交");
  console.log(`[api] player committed sequence=${playerSequence}`);

  const deadline = Date.now() + 150_000;
  let lastProgressAt = 0;
  let archive = playerArchive;
  let debug;
  while (Date.now() < deadline) {
    [archive, debug] = await Promise.all([
      getArchive(),
      getDebug().catch(() => undefined),
    ]);
    const afterPlayerRegistrations = archive.snapshot.events.filter((event) => (
      event.type === "actor.registered" &&
      playerSequence !== undefined &&
      event.sequence > playerSequence &&
      !prePlayerDynamicIds.has(event.actorId)
    ));
    const supportEvents = debug?.snapshot?.events?.filter((event) => (
      event.type === "narrator.director_requested" ||
      event.type === "director.support_started" ||
      event.type === "director.support_completed" ||
      event.type === "director.support_declined"
    )) ?? [];
    const spawnedIds = new Set(afterPlayerRegistrations.map((event) => event.actorId));
    const spawnedMessage = archive.snapshot.events.find((event) => (
      event.type === "context.message.committed" &&
      event.actorId &&
      spawnedIds.has(event.actorId)
    ));
    if (Date.now() - lastProgressAt >= 10_000) {
      lastProgressAt = Date.now();
      console.log(`[api] events=${archive.snapshot.eventSequence} narratorSupport=${supportEvents.length} ` +
        `spawnedAfterPlayer=${spawnedIds.size} directorRunning=${debug?.snapshot?.director?.running ?? "?"}`);
    }
    if (spawnedMessage || supportEvents.some((event) => event.type === "director.support_declined")) {
      result = buildResult({ archive, debug, prePlayerDynamicIds, playerSequence });
      break;
    }
    await sleep(1_000);
  }

  if (!result) {
    result = buildResult({
      archive: await getArchive(),
      debug: await getDebug().catch(() => undefined),
      prePlayerDynamicIds,
      playerSequence,
      timeout: true,
    });
  }
} finally {
  if (roomId) {
    await request(`/api/v1/worlds/${roomId}/stop`, { method: "POST" }).catch(() => undefined);
  }
}

const outputDirectory = resolve(".artifacts/local-narrator-spawn-api");
mkdirSync(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `run-${Date.now()}.json`);
writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");

console.log("");
console.log("=== Local API Narrator Spawn Check ===");
console.log(`supportRequested=${result.supportRequested} supportCompleted=${result.supportCompleted}`);
console.log(`spawnedAfterPlayer=${result.spawnedActors.length} spawnedMessages=${result.spawnedMessages.length}`);
console.log(`events=${result.eventSequence} tokens=${result.tokenUsage?.totalTokens ?? 0} timeout=${result.timeout}`);
for (const message of result.spawnedMessages) console.log(`[spawned] ${message.speaker}: ${message.message}`);
console.log(`artifact=${outputPath}`);

function createDraft() {
  return {
    schemaVersion: 1,
    id: `local-api-spawn-${Date.now()}`,
    revision: 0,
    metadata: {
      name: "本地 API 幕内引入测试",
      description: "玩家在进行中的一幕要求寻找不在场的一手目击者。",
      tone: "克制、事实导向、允许未知。",
    },
    premise: "傍晚的石亭里，两名过路者正在整理山口记录。他们都没有走过东侧山路，只知道纸面上出现了一串来源不明的车辙。",
    lore: {
      core: "当前在场者没有东侧山路的一手见闻。没有亲眼观察的人只能承认未知，不能代替目击者给出细节。",
      rules: [
        "角色只依据自己观察到的事实和已经听见的话行动。",
        "未知信息不能由当前角色凭空补全。",
      ],
    },
    player: {
      id: PLAYER_ID,
      mode: "participant",
      profile: {
        name: "穿越者",
        card: "来自异世的普通访客，没有本地职权，重视一手证据。",
      },
      playerCard: {
        name: "穿越者",
        identity: "来自异世、暂时落脚东路石亭的普通访客",
        background: "不熟悉本地山路与人员，只能依据现场公开信息提出问题。",
        personality: "重视证据，对未经确认的说法保持克制。",
        appearance: "穿着与当地略有不同的轻便衣物，随身带着一册空白笔记。",
        speechStyle: "直接、简洁，要求说清信息来源。",
        boundaries: "没有本地职权、专业资格或东侧山路的一手经历。",
      },
    },
    actors: [
      {
        id: "scribe",
        role: "lead",
        card: {
          name: "石亭抄录员",
          description: "只负责整理西侧入口文书的抄录员，从未走过东侧山路。",
          personality: "谨慎、简洁，不把推测当事实。",
          scenario: "正在石亭内整理旧记录，只能确认西侧入口发生的事。",
          messageExample: "东侧我没去过，这一条不能由我作证。",
          instructions: "明确承认自己没有东侧一手见闻，不得代替目击者补充车辙细节。",
        },
        background: "从未走过东侧山路，也不认识今天经过东侧的人。",
      },
      {
        id: "medic",
        role: "support",
        card: {
          name: "过路医者",
          description: "临时借宿石亭的医者，下午一直在室内整理药包。",
          personality: "温和、敏锐，对未知保持克制。",
          scenario: "没有离开过石亭，也没有观察东侧山路。",
          messageExample: "我可以帮忙判断伤势，但不能替没见过的事下结论。",
          instructions: "不得把推测包装成东侧目击事实。",
        },
        background: "今天没有进入东侧山路，没有任何车辙的一手知识。",
      },
    ],
    relations: [],
    contexts: [
      {
        id: CONTEXT_ID,
        name: "东路石亭",
        actorIds: ["scribe", "medic", PLAYER_ID],
        scene: {
          groupName: "东路石亭",
          topic: "整理现有线索并决定下一步调查方式",
          atmosphere: "傍晚，石亭外山风渐冷，东侧山路隐在雾里。",
          state: "flowing",
          rules: ["在场者均未走过东侧山路。"],
        },
        opening: "桌上摊着一张只有车辙方向、没有目击者署名的记录。两名在场者正在区分已知事实和猜测，等待访客提出下一步。",
      },
    ],
    chapters: [
      {
        id: "chapter-east-road",
        title: "无署名的东侧车辙",
        treatment: "东路石亭的桌上只有一张标出车辙方向、没有目击者署名的记录。记录员、过路医者与访客只能区分已经看见的痕迹和对来者身份的猜测；章节需要通过多场 Beat 核对记录、寻找可观察的补充线索，并逐步决定是否派人确认东侧山路。不要提前把车辙归给某个角色，也不要让访客获得没有依据的指挥权。",
        targetOutcome: "在不越过已知证据边界的前提下，形成一项可执行的东侧山路核查安排。",
        status: "active",
        actorIds: ["scribe", "medic", PLAYER_ID],
        contextIds: [CONTEXT_ID],
      },
    ],
    runtimeProfile: "world_story",
  };
}

function buildResult({ archive, debug, prePlayerDynamicIds, playerSequence, timeout = false }) {
  const events = archive.snapshot.events;
  const registered = events.filter((event) => (
    event.type === "actor.registered" &&
    playerSequence !== undefined &&
    event.sequence > playerSequence &&
    !prePlayerDynamicIds.has(event.actorId)
  ));
  const spawnedIds = new Set(registered.map((event) => event.actorId));
  const actorNames = new Map(archive.snapshot.dynamicActors.map((actor) => [
    actor.id,
    actor.card.name,
  ]));
  const debugEvents = debug?.snapshot?.events ?? [];
  const support = debugEvents.filter((event) => [
    "narrator.director_requested",
    "director.support_started",
    "director.support_completed",
    "director.support_declined",
  ].includes(event.type));
  return {
    roomId,
    playerSequence,
    timeout,
    eventSequence: archive.snapshot.eventSequence,
    supportRequested: support.some((event) => event.type === "narrator.director_requested"),
    supportCompleted: support.some((event) => event.type === "director.support_completed"),
    supportEvents: support.map((event) => ({ sequence: event.sequence, type: event.type, payload: event.payload })),
    spawnedActors: registered.map((event) => ({
      id: event.actorId,
      name: actorNames.get(event.actorId),
      sequence: event.sequence,
    })),
    spawnedMessages: events
      .filter((event) => event.type === "context.message.committed" && event.actorId && spawnedIds.has(event.actorId))
      .map((event) => ({
        actorId: event.actorId,
        speaker: event.payload.message.characterName,
        message: event.payload.message.message,
        sequence: event.sequence,
      })),
    recentEvents: events.slice(-20).map((event) => ({
      sequence: event.sequence,
      type: event.type,
      actorId: event.actorId,
      contextId: event.contextId,
    })),
    director: debug?.snapshot?.director,
    tokenUsage: debug?.snapshot?.tokenUsage,
    debugEventTypeCounts: countByType(debugEvents),
    elapsedMs: Date.now() - startedAt,
  };
}

async function getArchive() {
  return (await request(`/api/v1/worlds/${roomId}/archive`)).archive;
}

async function getDebug() {
  return (await request(`/api/v1/worlds/${roomId}/debug`)).debug;
}

async function waitForArchive(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const archive = await getArchive();
    if (predicate(archive)) return archive;
    await sleep(500);
  }
  throw new Error(`等待${label}超时（${timeoutMs}ms）。`);
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${value.message ?? value.error ?? text}`);
  return value;
}

function countByType(events) {
  return events.reduce((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
