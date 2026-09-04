import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = join(repoRoot, "apps", "world-server");
const serverEntry = join(serverRoot, "dist", "index.js");
const timeoutMs = Number(process.env.CONVERSATION_E2E_TIMEOUT_MS) || 150_000;
const artifactRoot = resolve(repoRoot, ".artifacts/conversation-live-e2e");
let child;

const playerCard = {
  name: "访客",
  identity: "来到档案室查询资料的普通访客",
  background: "不属于档案室工作人员，只能询问公开流程。",
  personality: "谨慎、礼貌、关注信息来源。",
  appearance: "深色便装，手持查询凭据。",
  speechStyle: "简洁直接，先问事实再表达判断。",
  boundaries: "没有内部权限，不能替工作人员作决定。",
};

async function run() {
  const report = { startedAt: new Date().toISOString(), checks: [], conversations: {} };
  try {
    const port = await findFreePort();
    child = spawn(process.execPath, [serverEntry], {
      cwd: serverRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childOutput = [];
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk) => {
        const line = String(chunk).replace(/\s+/g, " ").trim();
        if (line) childOutput.push(line.slice(0, 500));
        if (childOutput.length > 20) childOutput.shift();
      });
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(baseUrl);
    assert(health.providerConfigured === true, "服务端没有检测到真实 Provider 配置。 ");
    pass(report, "provider", "真实 Provider 已配置");

    await testGroup(baseUrl, report);
    await testPrivate(baseUrl, report);

    report.finishedAt = new Date().toISOString();
    report.serverOutput = childOutput;
    const artifact = await writeArtifact(report);
    console.log(`[conversation-e2e] artifact=${artifact}`);
    console.log(`[conversation-e2e] PASS ${report.checks.length} checks`);
  } catch (error) {
    report.finishedAt = new Date().toISOString();
    report.error = error instanceof Error ? error.message : String(error);
    const artifact = await writeArtifact(report);
    console.error(`[conversation-e2e] FAIL ${report.error}`);
    console.error(`[conversation-e2e] artifact=${artifact}`);
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode == null) {
      child.kill("SIGTERM");
      await delay(500);
      if (child.exitCode == null) child.kill("SIGKILL");
    }
  }
}

async function testGroup(baseUrl, report) {
  console.log("[conversation-e2e] group: creating GroupCard room");
  const created = await request(baseUrl, "/api/v1/worlds", {
    method: "POST",
    body: {
      source: {
        kind: "group_card",
        group: {
          kind: "chatverse.group",
          schemaVersion: 1,
          metadata: { id: "live-group", name: "档案室工作群" },
          characters: [
            {
              name: "林守",
              description: "负责闭馆和卷宗交接的档案管理员。",
              personality: "谨慎、简洁，先确认后行动。",
              scenario: "正在核对闭馆前最后一批卷宗。",
              messageExample: "先核对登记表，别急着拆封。",
            },
            {
              name: "沈录",
              description: "负责目录核验的记录员。",
              personality: "敏锐、务实，发现矛盾会追问来源。",
              scenario: "刚发现一条编号不一致的目录记录。",
              messageExample: "编号差了一位，我去找原始目录。",
            },
          ],
          userProfiles: [{ name: "访客", card: "到档案室查询资料的普通访客。" }],
          scene: {
            groupName: "档案室工作群",
            topic: "闭馆前核对卷宗",
            atmosphere: "安静、务实",
          },
          runtime: {
            pacing: { multiplier: 0 },
            interaction: { interventionCommitWindowMs: 0 },
          },
        },
      },
    },
  });
  const roomId = requiredString(created.roomId, "group roomId");
  const view = created.view;
  const context = view.contexts[0];
  const player = view.actors.find((actor) => actor.playerControlled === true);
  assert(context?.conversationMode === "group", "GroupCard 没有投影成 group context。");
  assert(context.actorRuntime?.activation === "autonomous_idle", "Group 没有使用 autonomous_idle。");
  pass(report, "group.create", "GroupCard 创建为 autonomous Harness Context");

  await request(baseUrl, `/api/v1/worlds/${roomId}/start`, { method: "POST" });
  const before = maxSequence(view.entries, context.id);
  await request(baseUrl, `/api/v1/worlds/${roomId}/messages`, {
    method: "POST",
    body: {
      contextId: context.id,
      actorId: requiredString(player?.id, "group player actor"),
      message: "@林守 @沈录 请分别说一下你们目前确认到的事实，不要猜测。",
    },
  });
  const replied = await waitForView(baseUrl, roomId, (candidate) => (
    candidate.entries.some((entry) => (
      entry.contextId === context.id && entry.kind === "character" && entry.sequence > before
    ))
  ));
  const replies = replied.entries.filter((entry) => (
    entry.contextId === context.id && entry.kind === "character" && entry.sequence > before
  ));
  assert(replies.length > 0, "Group 玩家消息后没有真实角色回复。");
  pass(report, "group.reply", `Group 收到 ${replies.length} 条角色回复`);

  const paused = await request(baseUrl, `/api/v1/worlds/${roomId}/context-pause`, {
    method: "POST",
    body: { contextId: context.id },
  });
  assert(paused.view.contexts.find((item) => item.id === context.id)?.status === "paused", "Group pause 失败。");
  const rejected = await rawRequest(baseUrl, `/api/v1/worlds/${roomId}/messages`, {
    method: "POST",
    body: { contextId: context.id, actorId: human.id, message: "暂停时不应发送。" },
  });
  assert(rejected.status === 409, `暂停 Group 仍接受消息（HTTP ${rejected.status}）。`);
  await request(baseUrl, `/api/v1/worlds/${roomId}/context-resume`, {
    method: "POST",
    body: { contextId: context.id },
  });
  pass(report, "group.lifecycle", "Group pause/resume 与暂停输入保护正常");
  await request(baseUrl, `/api/v1/worlds/${roomId}/stop`, { method: "POST" });

  report.conversations.group = {
    roomId,
    contextId: context.id,
    replies: replies.map(publicEntry),
  };
}

async function testPrivate(baseUrl, report) {
  console.log("[conversation-e2e] private: creating World and private context");
  const draft = {
    schemaVersion: 1,
    id: "live-private-world",
    revision: 0,
    metadata: {
      name: "档案室私聊验收",
      description: "验证 World Actor 私聊的真实 Provider 链路。",
      tone: "自然、克制",
    },
    premise: "闭馆后，访客可以向档案管理员询问一份卷宗的公开状态。",
    lore: { core: "未经核实的卷宗内容不能作为事实。", rules: ["角色不得泄露尚未确认的内容。"] },
    player: {
      id: "player",
      mode: "participant",
      profile: { name: playerCard.name, card: playerCard.identity },
      playerCard,
    },
    actors: [{
      id: "keeper",
      role: "lead",
      card: {
        name: "林守",
        description: "负责档案交接的管理员。",
        personality: "谨慎、简洁、尊重流程。",
        scenario: "闭馆后仍在处理一份状态未明的卷宗。",
        messageExample: "我能告诉你的只有登记状态，内容还不能确认。",
      },
      background: "知道卷宗尚未完成登记，但不知道里面的内容是否真实。",
    }],
    relations: [],
    contexts: [{
      id: "archive-main",
      name: "旧档案室",
      actorIds: ["keeper", "player"],
      scene: {
        groupName: "旧档案室",
        topic: "闭馆后的卷宗状态",
        atmosphere: "走廊灯已经熄灭，只剩值班台灯。",
        state: "flowing",
      },
      opening: "闭馆铃声过后，值班台上仍放着一份没有归档的卷宗。",
    }],
    chapters: [{
      id: "chapter-record",
      title: "未归档卷宗",
      treatment: "闭馆后的值班台仍留着一份没有归档的卷宗。管理员只能依据标签、交接记录和自己亲眼看到的内容回答访客；访客可以追问，但不能把猜测当作已核实事实。章节通过数次问答逐渐厘清卷宗当前状态、缺失的交接环节和下一步保管责任，不提前替任何一方宣布结论。",
      targetOutcome: "管理员与访客共同确认卷宗当前可核实状态，并明确下一步保管责任。",
      status: "active",
      actorIds: ["keeper"],
      contextIds: ["archive-main"],
    }],
    runtimeProfile: "world_story",
  };
  const created = await request(baseUrl, "/api/v1/worlds", {
    method: "POST",
    body: { source: { kind: "world_draft", draft } },
  });
  const roomId = requiredString(created.roomId, "private roomId");
  const opened = await request(baseUrl, `/api/v1/worlds/${roomId}/contexts`, {
    method: "POST",
    body: { conversationMode: "private", actorIds: ["keeper"], humanActorId: "player" },
  });
  const contextId = requiredString(opened.contextId, "private contextId");
  const context = opened.view.contexts.find((item) => item.id === contextId);
  assert(context?.conversationMode === "private", "私聊 Context 类型错误。");
  assert(context.actorRuntime?.activation === "beat_runtime", "私聊没有使用 ask-response Runtime。");
  pass(report, "private.create", "Private Context 创建为 ask-response Runtime");

  const before = maxSequence(opened.view.entries, contextId);
  await request(baseUrl, `/api/v1/worlds/${roomId}/messages`, {
    method: "POST",
    body: {
      contextId,
      actorId: "player",
      message: "林守，我只问已经核实的部分：这份卷宗现在完成登记了吗？",
    },
  });
  const replied = await waitForView(baseUrl, roomId, (candidate) => (
    candidate.entries.some((entry) => (
      entry.contextId === contextId
      && entry.kind === "character"
      && entry.actorId === "keeper"
      && entry.sequence > before
    ))
  ));
  const replies = replied.entries.filter((entry) => (
    entry.contextId === contextId
    && entry.kind === "character"
    && entry.actorId === "keeper"
    && entry.sequence > before
  ));
  assert(replies.length > 0, "Private 玩家消息后没有目标 Actor 回复。");
  assert(replied.entries.every((entry) => (
    entry.contextId !== contextId || entry.actorId === undefined || entry.actorId === "player" || entry.actorId === "keeper"
  )), "Private 出现了非会话成员内容。");
  pass(report, "private.reply", `Private 收到 ${replies.length} 条目标 Actor 回复`);
  pass(report, "private.isolation", "Private 历史只包含会话成员");

  await request(baseUrl, `/api/v1/worlds/${roomId}/context-pause`, {
    method: "POST",
    body: { contextId },
  });
  pass(report, "private.lifecycle", "Private pause 正常");
  await request(baseUrl, `/api/v1/worlds/${roomId}/stop`, { method: "POST" });

  report.conversations.private = {
    roomId,
    contextId,
    replies: replies.map(publicEntry),
  };
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { return await request(baseUrl, "/healthz"); } catch { await delay(200); }
  }
  throw new Error("等待 World Server 健康检查超时。");
}

async function waitForView(baseUrl, roomId, predicate) {
  const deadline = Date.now() + timeoutMs;
  let lastView;
  while (Date.now() < deadline) {
    lastView = (await request(baseUrl, `/api/v1/worlds/${roomId}`)).view;
    if (predicate(lastView)) return lastView;
    await delay(500);
  }
  throw new Error(`等待会话输出超时；最后事件序号 ${lastView?.world?.eventSequence ?? "unknown"}。`);
}

async function request(baseUrl, path, options = {}) {
  const result = await rawRequest(baseUrl, path, options);
  if (!result.ok) {
    throw new Error(`${path} 请求失败（HTTP ${result.status}）：${result.payload.message || result.payload.code || "unknown"}`);
  }
  return result.payload;
}

async function rawRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* reported below */ }
  return { ok: response.ok, status: response.status, payload };
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
  return requiredString(port && String(port), "free port");
}

function maxSequence(entries, contextId) {
  return Math.max(0, ...entries.filter((entry) => entry.contextId === contextId).map((entry) => entry.sequence));
}

function publicEntry(entry) {
  return { actorId: entry.actorId, actorName: entry.actorName, text: entry.text };
}

function pass(report, id, message) {
  report.checks.push({ id, passed: true, message });
  console.log(`[conversation-e2e] PASS ${id}: ${message}`);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`缺少 ${label}。`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeArtifact(report) {
  await mkdir(artifactRoot, { recursive: true });
  const path = join(artifactRoot, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

void run();
