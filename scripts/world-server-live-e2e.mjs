import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateE2eBudget,
  resolveE2eBudget,
  summarizeE2eUsage,
} from "@chatverse/world-benchmark";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = join(repoRoot, "apps", "world-server");
const serverEntry = join(serverRoot, "dist", "index.js");
const timeoutMs = positiveInteger(process.env.WORLD_E2E_TIMEOUT_MS, 180_000);
const artifactRoot = resolve(
  repoRoot,
  process.env.WORLD_E2E_ARTIFACT_DIR || ".artifacts/world-server-e2e",
);
const budget = resolveE2eBudget();

const draft = {
  schemaVersion: 1,
  id: "live-server-e2e-world",
  revision: 0,
  metadata: {
    name: "真实服务端验收世界",
    description: "用于验证真实 HTTP、SSE、Director 和 Actor 链路的最小世界。",
    tone: "克制、可观察、允许角色保留未知。",
  },
  premise: "暮色中的旅人来到一座封闭的旧档案室，守门人和记录员必须决定是否打开一份尚未归档的卷宗。",
  lore: {
    core: "档案室正在闭馆，卷宗的封条尚未被确认，任何人都不能把猜测当成已经验证的事实。",
    rules: [
      "角色只依据自己观察到的事实和已经听见的话行动。",
      "世界可以暂停，暂停不代表故事已经结束。",
    ],
  },
  player: {
    id: "player",
    mode: "participant",
    profile: { name: "访客", card: "临时来到档案室的访客，正在观察并可以提问。" },
    playerCard: {
      name: "访客",
      identity: "临时到访旧档案室的普通访客",
      background: "因一份查询申请来到档案室，不属于档案室工作人员。",
      personality: "谨慎、尊重流程，对未经确认的信息保持怀疑。",
      appearance: "穿着深色便装，随身带着一只旧文件袋。",
      speechStyle: "礼貌、直接，倾向先询问事实来源。",
      boundaries: "不能调用档案室内部权限，也不能替工作人员作出决定。",
    },
  },
  actors: [
    {
      id: "archive-keeper",
      role: "lead",
      card: {
        name: "林守",
        description: "负责闭馆与卷宗交接的档案室管理员。",
        personality: "谨慎、简洁、先确认再行动。",
        scenario: "正在清点最后一批卷宗，听见门外有人靠近。",
        messageExample: "先别碰封条，我要确认登记时间。",
      },
      background: "知道档案室的流程，但不知道这份卷宗为何没有出现在交接表上。",
    },
    {
      id: "record-clerk",
      role: "support",
      card: {
        name: "沈录",
        description: "负责核对目录和手写记录的年轻记录员。",
        personality: "敏锐、略显急促，遇到矛盾会追问来源。",
        scenario: "刚发现目录上的编号与卷宗封面不完全一致。",
        messageExample: "编号差了一位，我先把原始目录找出来。",
      },
      background: "只看过目录和当前卷宗的封面，尚未确认里面的内容。",
    },
  ],
  relations: [{
    id: "keeper-clerk",
    fromActorId: "archive-keeper",
    toActorId: "record-clerk",
    description: "林守负责流程，沈录负责核对记录；两人相互依赖但处理速度不同。",
  }],
  contexts: [{
    id: "archive-room",
    name: "旧档案室",
    actorIds: ["archive-keeper", "record-clerk", "player"],
    scene: {
      groupName: "旧档案室",
      topic: "闭馆前的卷宗核对",
      atmosphere: "暮色、纸张气味和即将熄灭的走廊灯。",
      state: "flowing",
    },
    opening: "闭馆铃声已经响过，最里面的铁柜旁还亮着一盏台灯。",
  }],
  chapters: [{
    id: "chapter-seal-check",
    title: "未登记的封条",
    treatment: "闭馆后的旧档案室里，两名工作人员必须核对一份未登记封条的卷宗来源。林守负责守住流程和交接边界，沈录负责把目录、封面和原始记录逐项比对。封条的编号、盖印时间与经手人可能互相矛盾，但当前只能依据已经看到的材料推进，不能预先断言卷宗内容或责任归属。章节允许通过补找目录、核对交接和决定是否延迟封存逐步改变现场处置条件；需要经历多场 Beat，最后形成一项可执行且有记录的封存决定。",
    targetOutcome: "完成未登记卷宗的来源核对，并形成一项由现场负责人确认的封存或继续调查决定。",
    status: "active",
    actorIds: ["archive-keeper", "record-clerk"],
    contextIds: ["archive-room"],
  }],
  runtimeProfile: "world_story",
};

const observed = [];
const childOutput = [];
let playerMessageObserved = false;
let child;
let stream;
let stage = "initializing";
let stageStartedAt = Date.now();
const phaseDurations = {};

async function run() {
try {
  const port = await findFreePort();
  child = spawn(process.execPath, [serverEntry], {
    cwd: serverRoot,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => rememberChildOutput(chunk));
  child.stderr?.on("data", (chunk) => rememberChildOutput(chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(baseUrl);
  assert(health.providerConfigured === true, "真实服务器未检测到自身 Provider 配置。");
  console.log(`[live-e2e] server ready providerConfigured=${health.providerConfigured}`);

  const created = await request(baseUrl, "/api/v1/worlds", {
    method: "POST",
    body: { source: { kind: "world_draft", draft } },
  });
  const roomId = stringValue(created.roomId, "roomId");
  const contextId = draft.contexts[0].id;
  const playerId = draft.player.id;
  assertNoCredential(created, "create");
  assert(created.view?.world?.status === "idle", "新建世界没有处于 idle 状态。");
  console.log(`[live-e2e] created room=${roomId}`);

  enterStage("bootstrap");
  stream = await SseStream.open(`${baseUrl}/api/v1/worlds/${roomId}/stream`);
  await request(baseUrl, `/api/v1/worlds/${roomId}/start`, { method: "POST" });
  await waitForAll(stream, "bootstrap", [
    {
      id: "narration",
      predicate: (message) => isWorldEvent(message, "narrative.narration.committed"),
    },
    {
      id: "director-completed",
      predicate: (message) => isWorldNotification(message, "director.completed"),
    },
  ]);
  await captureSettlingEvents(stream);
  let view = (await request(baseUrl, `/api/v1/worlds/${roomId}`)).view;
  assert(view.world.status === "running", "启动后的世界不是 running 状态。");
  assert(view.entries.some((entry) => entry.kind === "narration"), "启动后没有可见旁白。");
  console.log(`[live-e2e] bootstrap entries=${view.entries.length}`);
  await acknowledgeCurrentPresentation(baseUrl, roomId, contextId);

  const direction = "让走廊突然停电，紧急照明亮起，众人转移到地下阅览室继续核对卷宗。";
  enterStage("world-direction");
  await request(baseUrl, `/api/v1/worlds/${roomId}/direction`, {
    method: "POST",
    body: { contextId, direction },
  });
  const redirected = await waitFor(stream, "Narrator direction rewrite", (message) => (
    isWorldEvent(message, "narrative.narration.committed")
    && typeof message.event.payload?.narration?.text === "string"
    && message.event.payload.narration.text !== direction
  ));
  await captureSettlingEvents(stream);
  view = (await request(baseUrl, `/api/v1/worlds/${roomId}`)).view;
  const redirectedText = redirected.event.payload.narration.text;
  assert(
    /停电|紧急照明|地下|阅览室/.test(`${redirectedText}\n${view.contexts[0]?.scene?.text || ""}`),
    "Narrator 没有把改变走向落实到旁白或当前场景。",
  );
  assert(!JSON.stringify(view).includes(direction), "幕后改变走向原文泄露进 WorldView。");
  assert(!JSON.stringify(observed).includes(direction), "幕后改变走向原文泄露进 SSE 事件流。");
  console.log(`[live-e2e] direction rewritten=${JSON.stringify(redirectedText)}`);
  await acknowledgeCurrentPresentation(baseUrl, roomId, contextId);

  const beforeMessageSequence = view.world.eventSequence;
  enterStage("player-message");
  await request(baseUrl, `/api/v1/worlds/${roomId}/messages`, {
    method: "POST",
    body: {
      contextId,
      actorId: playerId,
      message: "我先不碰卷宗，只想知道你们现在确认了什么。",
    },
  });
  await waitFor(stream, "player message commit", (message) => (
    isWorldEvent(message, "context.message.committed")
    && message.event.payload?.message?.source === "human"
  ), {
    onMatch: () => { playerMessageObserved = true; },
  });
  await acknowledgeCurrentPresentation(baseUrl, roomId, contextId);
  await waitFor(stream, "player response activity", (message) => (
    isWorldEvent(message, "context.message.committed")
    || isWorldEvent(message, "narrative.narration.committed")
    || isWorldNotification(message, "director.completed")
  ));
  await captureSettlingEvents(stream);
  view = (await request(baseUrl, `/api/v1/worlds/${roomId}`)).view;
  assert(view.world.eventSequence > beforeMessageSequence, "玩家消息没有推进世界事件序号。");
  console.log(`[live-e2e] player input eventSequence=${view.world.eventSequence}`);
  await acknowledgeCurrentPresentation(baseUrl, roomId, contextId);

  enterStage("observer-progression");
  await request(baseUrl, `/api/v1/worlds/${roomId}/progression`, {
    method: "POST",
    body: { contextId },
  });
  await waitFor(stream, "observer progression request", (message) => (
    isWorldEvent(message, "world.progression.requested")
  ));
  await waitFor(stream, "observer progression handling", (message) => (
    isWorldNotification(message, "director.completed")
    || isWorldNotification(message, "narrator.completed")
  ));
  await captureSettlingEvents(stream);

  enterStage("lifecycle-controls");
  const replay = await SseStream.open(`${baseUrl}/api/v1/worlds/${roomId}/stream`, {
    headers: { "Last-Event-ID": "0" },
    capture: false,
  });
  const replayed = await replay.next(timeoutMs);
  assert(replayed?.sequence > 0, "SSE Last-Event-ID 没有返回历史事件。");
  assert(replayed.kind !== "resync_required", "小规模验收不应触发 SSE resync。");
  await replay.close();
  console.log(`[live-e2e] sse replay firstSequence=${replayed.sequence}`);

  let paused = await request(baseUrl, `/api/v1/worlds/${roomId}/pause`, { method: "POST" });
  assert(paused.view?.world?.status === "paused", "pause 没有使世界进入 paused。");
  let resumed = await request(baseUrl, `/api/v1/worlds/${roomId}/resume`, { method: "POST" });
  assert(resumed.view?.world?.status === "running", "resume 没有恢复 running。");
  const stopped = await request(baseUrl, `/api/v1/worlds/${roomId}/stop`, { method: "POST" });
  assert(stopped.view?.world?.status === "stopped", "stop 没有使世界进入 stopped。");
  assertNoCredential(stopped, "stop");
  assertLifecycle(observed, { playerMessageObserved });
  finishStage();
  stage = "budget-evaluation";
  const usage = summarizeE2eUsage(observed, phaseDurations);
  const budgetEvaluation = evaluateE2eBudget(usage, budget);

  const artifact = await writeArtifact({
    roomId,
    health,
    view: stopped.view,
    observed,
    summary: summarize(observed),
    usage,
    budget,
    budgetEvaluation,
  });
  printUsageSummary(usage, budgetEvaluation);
  console.log(`[live-e2e] artifact=${artifact}`);
  if (!budgetEvaluation.passed) {
    throw new Error(
      `真实运行超过 ${budgetEvaluation.checks.filter((check) => !check.passed).length} 项发布预算。`,
    );
  }
  console.log("[live-e2e] PASS lifecycle and release budgets");
} catch (error) {
  console.error(`[live-e2e] FAIL stage=${stage} ${error instanceof Error ? error.message : String(error)}`);
  if (childOutput.length) console.error(`[live-e2e] server process exited or reported an error.`);
  process.exitCode = 1;
} finally {
  await stream?.close();
  if (child && child.exitCode == null) {
    child.kill("SIGTERM");
    await onceExit(child, 2_000);
    if (child.exitCode == null) child.kill("SIGKILL");
  }
}
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  assert(port, "无法找到可用端口。");
  return port;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";
  while (Date.now() < deadline) {
    try {
      return await request(baseUrl, "/healthz");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(250);
    }
  }
  throw new Error(`等待真实服务端健康检查超时：${lastError}`);
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path} 返回了非 JSON 响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    throw new Error(
      `${path} 请求失败（HTTP ${response.status}）：`
      + `${payload.error?.message || payload.error?.code || payload.message || payload.code || "unknown"}`,
    );
  }
  return payload;
}

async function acknowledgeCurrentPresentation(baseUrl, roomId, contextId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const view = (await request(baseUrl, `/api/v1/worlds/${roomId}`)).view;
    const context = view.contexts.find((candidate) => candidate.id === contextId);
    const turn = context?.presentationTurn;
    if (!turn || turn.status === "waiting_player") return false;
    if (turn.status !== "waiting_ack") {
      await delay(100);
      continue;
    }
    try {
      await request(baseUrl, `/api/v1/worlds/${roomId}/presentation/ack`, {
        method: "POST",
        body: { contextId, turnToken: turn.turnToken },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("presentation_locked")) throw error;
      await delay(250);
    }
  }
  throw new Error("等待当前演出内容可确认超时。");
}

class SseStream {
  constructor(response, controller) {
    this.controller = controller;
    this.reader = response.body.getReader();
    this.decoder = new TextDecoder();
    this.buffer = "";
    this.capture = true;
    this.messages = [];
    this.nextCursor = 0;
    this.waiters = new Set();
    this.error = undefined;
    this.closed = false;
    this.lastMessageAt = Date.now();
    this.pumpPromise = this.pump();
  }

  static async open(url, options = {}) {
    const controller = new AbortController();
    const response = await fetch(url, {
      headers: { Accept: "text/event-stream", ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`SSE 连接失败（HTTP ${response.status}）。`);
    const stream = new SseStream(response, controller);
    stream.capture = options.capture !== false;
    return stream;
  }

  async next(waitMs) {
    const deadline = Date.now() + waitMs;
    while (true) {
      if (this.nextCursor < this.messages.length) return this.messages[this.nextCursor++];
      if (this.error) throw this.error;
      if (this.closed) throw new Error("SSE 连接提前关闭。");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("SSE 等待事件超时。");
      await this.waitForMessage(remaining);
    }
  }

  async close() {
    this.controller.abort();
    try { await this.reader.cancel(); } catch { /* already closed */ }
    try { await this.pumpPromise; } catch { /* reported by pending readers */ }
  }

  async pump() {
    try {
      while (true) {
        const result = await this.reader.read();
        if (result.done) {
          this.closed = true;
          this.wakeWaiters();
          return;
        }
        this.buffer += this.decoder.decode(result.value, { stream: true });
        this.drainBuffer();
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.error = error instanceof Error ? error : new Error(String(error));
      }
      this.closed = true;
      this.wakeWaiters();
    }
  }

  drainBuffer() {
    while (true) {
      const blockEnd = this.buffer.indexOf("\n\n");
      if (blockEnd < 0) return;
      const block = this.buffer.slice(0, blockEnd);
      this.buffer = this.buffer.slice(blockEnd + 2);
      const message = parseSseBlock(block);
      if (!message) continue;
      const captured = { ...message, observedPhase: stage };
      this.lastMessageAt = Date.now();
      this.messages.push(captured);
      if (this.capture) observed.push(captured);
      this.wakeWaiters();
    }
  }

  waitForMessage(waitMs) {
    return new Promise((resolvePromise, reject) => {
      const waiter = () => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolvePromise();
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error("SSE 等待事件超时。"));
      }, waitMs);
      this.waiters.add(waiter);
    });
  }

  wakeWaiters() {
    for (const waiter of [...this.waiters]) waiter();
  }
}

void run();

async function waitFor(sse, label, predicate, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || timeoutMs);
  while (Date.now() < deadline) {
    const message = await sse.next(Math.max(1, deadline - Date.now()));
    if (predicate(message)) {
      options.onMatch?.(message);
      return message;
    }
  }
  throw new Error(`等待 ${label} 超时。`);
}

async function waitForAll(sse, label, requirements, options = {}) {
  const pending = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const deadline = Date.now() + (options.timeoutMs || timeoutMs);
  while (pending.size > 0 && Date.now() < deadline) {
    const message = await sse.next(Math.max(1, deadline - Date.now()));
    for (const [id, requirement] of pending) {
      if (!requirement.predicate(message)) continue;
      requirement.onMatch?.(message);
      pending.delete(id);
    }
  }
  if (pending.size > 0) {
    throw new Error(`等待 ${label} 超时，缺少：${[...pending.keys()].join("、")}。`);
  }
}

async function captureSettlingEvents(sse) {
  const quietMs = 800;
  const maxMs = 3_000;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const remaining = Math.min(quietMs, deadline - Date.now());
    if (remaining <= 0) return;
    try {
      await sse.next(remaining);
    } catch (error) {
      if (error instanceof Error && error.message === "SSE 等待事件超时。") return;
      throw error;
    }
  }
}

function parseSseBlock(block) {
  let id;
  let kind;
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).trimStart() : "";
    if (field === "id") id = Number(value);
    if (field === "event") kind = value;
    if (field === "data") data.push(value);
  }
  if (!data.length || !kind) return undefined;
  return { sequence: id, kind, ...JSON.parse(data.join("\n")) };
}

function isWorldEvent(message, type) {
  return message.kind === "world_event" && message.event?.type === type;
}

function isWorldNotification(message, type) {
  return message.kind === "world_notification" && message.notification?.type === type;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stringValue(value, name) {
  assert(typeof value === "string" && value.length > 0, `响应缺少 ${name}。`);
  return value;
}

function assertNoCredential(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes("OPENAI_API_KEY"), `${label} 响应泄露了 OPENAI_API_KEY 字段。`);
  assert(!serialized.includes("DEEPSEEK_API_KEY"), `${label} 响应泄露了 DEEPSEEK_API_KEY 字段。`);
}

function summarize(messages) {
  const events = messages.filter((message) => message.kind === "world_event");
  const notifications = messages.filter((message) => message.kind === "world_notification");
  return {
    maxSequence: Math.max(0, ...messages.map((message) => message.sequence || 0)),
    eventTypes: [...new Set(events.map((message) => message.event.type))],
    notificationTypes: [...new Set(notifications.map((message) => message.notification.type))],
    narrations: events.filter((message) => message.event.type === "narrative.narration.committed").length,
    humanMessages: events.filter((message) => (
      message.event.type === "context.message.committed"
      && message.event.payload?.message?.source === "human"
    )).length,
    characterMessages: events.filter((message) => (
      message.event.type === "context.message.committed"
      && message.event.payload?.message?.source === "character"
    )).length,
    usageRecords: messages.filter((message) => message.kind === "usage_recorded").length,
    totalTokens: messages
      .filter((message) => message.kind === "usage_recorded")
      .reduce((total, message) => total + Number(message.record?.totalTokens || 0), 0),
  };
}

function assertLifecycle(messages, state) {
  const eventTypes = new Set(
    messages.filter((message) => message.kind === "world_event").map((message) => message.event.type),
  );
  const notificationTypes = new Set(
    messages
      .filter((message) => message.kind === "world_notification")
      .map((message) => message.notification.type),
  );
  for (const type of [
    "context.activated",
    "world.progression.requested",
    "narrative.narration.committed",
    "context.message.committed",
  ]) {
    assert(eventTypes.has(type), `真实运行缺少世界事件 ${type}。`);
  }
  for (const type of ["world.status_changed", "director.started", "director.completed"]) {
    assert(notificationTypes.has(type), `真实运行缺少运行通知 ${type}。`);
  }
  assert(state.playerMessageObserved, "真实运行没有提交玩家消息。");
  assert(messages.some((message) => message.kind === "usage_recorded"), "真实运行没有 Provider 用量记录。");
  assert(
    messages.every((message, index) => index === 0 || message.sequence > messages[index - 1].sequence),
    "主 SSE 流的 stream sequence 没有严格递增。",
  );
  const errors = messages.filter((message) => (
    message.kind === "world_notification"
    && /(?:^|\.)(?:error)$/.test(message.notification.type)
  ));
  assert(errors.length === 0, `真实运行产生了 ${errors.length} 条错误通知。`);
}

function enterStage(nextStage) {
  finishStage();
  stage = nextStage;
  stageStartedAt = Date.now();
}

function finishStage() {
  if (!phaseDurations[stage] && stage !== "initializing") {
    phaseDurations[stage] = Date.now() - stageStartedAt;
  }
}

function printUsageSummary(usage, evaluation) {
  console.log("");
  console.log("[live-e2e] phase usage");
  for (const [phase, metrics] of Object.entries(usage.phases)) {
    console.log(
      `[live-e2e]   ${phase} duration=${formatSeconds(metrics.durationMs)}`
      + ` calls=${metrics.providerCalls}`
      + ` tokens=${metrics.totalTokens}`
      + ` cache=${formatRate(metrics.cacheHitRate)}`
      + ` roles=${formatRoleCalls(metrics.byRole)}`,
    );
  }
  console.log(
    `[live-e2e] total duration=${formatSeconds(usage.total.durationMs)}`
    + ` calls=${usage.total.providerCalls}`
    + ` tokens=${usage.total.totalTokens}`
    + ` cache=${formatRate(usage.total.cacheHitRate)}`
    + ` ambient=${usage.total.ambientTriggers}`,
  );
  for (const check of evaluation.checks) {
    console.log(
      `[live-e2e] ${check.passed ? "PASS" : "FAIL"} ${check.label}: `
      + `${formatBudgetValue(check.id, check.actual)} ${check.operator} ${formatBudgetValue(check.id, check.limit)}`,
    );
  }
}

function formatRoleCalls(byRole) {
  const entries = Object.entries(byRole).map(([role, metrics]) => `${role}:${metrics.calls}`);
  return entries.length ? entries.join(",") : "none";
}

function formatBudgetValue(id, value) {
  return id === "cache_hit_rate" ? formatRate(value) : String(value);
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

async function writeArtifact(value) {
  await mkdir(artifactRoot, { recursive: true });
  const file = join(artifactRoot, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function rememberChildOutput(chunk) {
  const text = String(chunk).replace(/\s+/g, " ").trim();
  if (text) childOutput.push(text.slice(0, 300));
  if (childOutput.length > 8) childOutput.shift();
}

function onceExit(process, waitMs) {
  if (process.exitCode != null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, waitMs);
    process.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
