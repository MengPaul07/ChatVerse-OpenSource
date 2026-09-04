import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = join(repoRoot, "apps", "world-server");
const serverEntry = join(serverRoot, "dist", "index.js");
const artifactRoot = join(repoRoot, ".artifacts", "galgame-live-e2e");
const timeoutMs = positiveInteger(process.env.GALGAME_E2E_TIMEOUT_MS, 240_000);
const holdMs = positiveInteger(process.env.GALGAME_E2E_HOLD_MS, 1_500);
const targetVisibleTurns = positiveInteger(process.env.GALGAME_E2E_TURNS, 12);
const adversarialPlayerMessage = process.env.GALGAME_E2E_PLAYER_MESSAGE?.trim();
const adversarialPlayerAction = process.env.GALGAME_E2E_PLAYER_ACTION?.trim();
const adversarialTurns = parseAdversarialTurns(process.env.GALGAME_E2E_ADVERSARIAL_TURNS);
const runUntilInitialBeatCompletes = process.env.GALGAME_E2E_UNTIL_BEAT_COMPLETE === "true";

const draft = {
  schemaVersion: 1,
  id: "galgame-live-five-elements-mountain",
  revision: 0,
  metadata: {
    name: "五行山 · 真实 Galgame 验收",
    description: "使用真实模型验证 Director、Narrator、逐棒确认与玩家提案。",
    tone: "古典、克制、带神话庄严感",
    tags: ["Galgame", "西游记", "真实 API 验收"],
  },
  premise: "唐三藏来到五行山，孙悟空等待法帖被揭，一名旅人也在暮色中走进这场相遇。",
  lore: {
    core: "取材自公版古典小说《西游记》。孙悟空受法帖压在五行山下，唐三藏正奉命西行。",
    rules: [
      "角色只依据亲历和被告知的信息行动。",
      "使用古典语感但保持对话可读，不预写玩家决定。",
    ],
  },
  player: {
    id: "traveler",
    mode: "participant",
    profile: { name: "旅人", card: "沿西行古道来到五行山下的凡人旅者。" },
    playerCard: {
      name: "旅人",
      identity: "偶然来到五行山下的凡人旅者",
      background: "沿西行古道赶路，在暮色中听见山石下的呼喊。",
      personality: "谨慎但富有好奇心，愿意先观察再作决定。",
      appearance: "轻装旅行，背着旧行囊，衣角带着山路尘土。",
      speechStyle: "自然简洁，会直接追问不明白的事情。",
      boundaries: "不替玩家作出伤害无辜者的决定。",
    },
  },
  actors: [
    {
      id: "wukong",
      role: "lead",
      card: {
        name: "孙悟空",
        description: "被压在五行山下五百年的齐天大圣。",
        personality: "机敏、骄傲、急切，言语爽利。",
        scenario: "听见马蹄与脚步接近，认定脱困时机已经来到。",
        messageExample: "那和尚，可敢替俺揭一张帖子？",
        instructions: "先回应眼前来人，再把是否靠近石缝的选择交给玩家旅人；不要替玩家作答。",
      },
      background: "知道自己因大闹天宫被压在山下，盼望取经人揭下法帖。",
    },
    {
      id: "sanzang",
      role: "lead",
      card: {
        name: "唐三藏",
        description: "奉命西行取经的僧人。",
        personality: "温和谨慎，重因果与承诺。",
        scenario: "初到五行山，只听见山下有人呼喊。",
        messageExample: "施主且慢，贫僧须先问明缘由。",
        instructions: "询问缘由后应让同行旅人表达观察或选择；不要替玩家作答。",
      },
      background: "并不知道山下受困者的完整来历，必须先判断其言行。",
    },
  ],
  relations: [
    { id: "wukong-sanzang", fromActorId: "wukong", toActorId: "sanzang", description: "盼望对方解救自己，也在判断其是否值得追随。" },
    { id: "sanzang-wukong", fromActorId: "sanzang", toActorId: "wukong", description: "同情其受困，又担忧其难驯。" },
  ],
  contexts: [{
    id: "five-elements-mountain",
    name: "五行山下",
    actorIds: ["wukong", "sanzang", "traveler"],
    scene: {
      groupName: "五行山下",
      topic: "揭帖之前的相遇",
      atmosphere: "暮色、山风与法帖金光交织。",
      state: "flowing",
      rules: ["角色不可替玩家作出选择。"],
    },
    opening: "暮色压住乱石，远处马蹄渐近，山脚裂隙中一只手轻叩石壁。",
    presentation: {
      kind: "galgame",
      playerActorId: "traveler",
      artDirection: "东方古典神话视觉小说，工笔质感与电影光影结合，暮色金光，克制庄严",
      backgroundGeneration: "auto",
      acknowledgement: "required",
    },
  }],
  chapters: [{
    id: "chapter-seal",
    title: "法帖是否揭下",
    treatment: "五行山下的暮色相遇刚刚开始。唐三藏需要确认孙悟空是否真正接受戒律与师徒约束，孙悟空则必须在屈辱、自由和西行机会之间作出实际回应；作为穿越者，玩家只能以自己的经历和观察参与，不能替唐三藏授予法名或替孙悟空承诺。章节应通过多场 Beat 逐步揭开旧因、试探承诺、确认同行条件，并让每个角色依据已知信息改变立场。具体对白与最终选择留给运行时，不能把揭帖、收徒或西行结果提前写成事实。",
    targetOutcome: "唐三藏与孙悟空形成一项明确、可执行的同行约定，玩家的介入方式也被现场角色正确理解。",
    status: "active",
    actorIds: ["wukong", "sanzang", "traveler"],
    contextIds: ["five-elements-mountain"],
    beatIds: [],
  }, {
    id: "chapter-departure",
    title: "从五行山走上西行路",
    treatment: "孙悟空脱困并不等于师徒已经彼此信任。离开五行山后，三人必须把同行约定放进真实路途：如何辨认方向、分担风险、处理孙悟空的力量边界，以及面对第一次外部冲突时由谁作出决定。章节允许玩家以凡人旅者的观察和选择影响队伍关系，但不能凭空获得神通或宗教权威。多场 Beat 应让口头约定经历行动检验，并留下既能继续西行、又仍有原则矛盾的稳定局面。",
    targetOutcome: "三人完成离开五行山后的第一段共同旅程，并形成经过实际行动检验的职责边界与同行秩序。",
    status: "queued",
    actorIds: ["wukong", "sanzang", "traveler"],
    contextIds: ["five-elements-mountain"],
    beatIds: [],
  }],
  runtimeProfile: "world_story",
};

let child;
let stream;

async function run() {
  const startedAt = Date.now();
  const observations = [];
  const turns = [];
  const playerProposals = [];
  let roomId;
  let baseUrl;
  let playerTurnObserved = false;
  let imageFallbackVerified = false;
  let initialBeatId;
  let initialBeatCompleted = false;

  try {
    const port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [serverEntry], {
      cwd: serverRoot,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childOutput = [];
    child.stdout?.on("data", (chunk) => rememberOutput(childOutput, chunk));
    child.stderr?.on("data", (chunk) => rememberOutput(childOutput, chunk));

    const health = await waitForHealth(baseUrl);
    assert(health.providerConfigured === true, "真实服务端没有读取到文本 Provider 配置。");
    console.log(`[galgame-e2e] server ready port=${port}`);

    const created = await request(baseUrl, "/api/v1/worlds", {
      method: "POST",
      body: { source: { kind: "world_draft", draft } },
    });
    roomId = requiredString(created.roomId, "roomId");
    stream = await SseCapture.open(`${baseUrl}/api/v1/worlds/${roomId}/stream`, observations);
    await request(baseUrl, `/api/v1/worlds/${roomId}/start`, { method: "POST" });
    console.log(`[galgame-e2e] world started room=${roomId}`);

    const imageResponse = await requestRaw(baseUrl, "/api/v1/images/generate", {
      method: "POST",
      body: { prompt: "五行山暮色背景", size: "1536x1024" },
    });
    imageFallbackVerified = imageResponse.status === 400
      && imageResponse.payload?.code === "image_provider_not_configured";
    assert(imageFallbackVerified, "未配置图片 Provider 时没有返回可恢复错误。");
    console.log("[galgame-e2e] image provider missing -> graceful fallback confirmed");

    let visibleTurnCount = 0;
    let lastEntrySequence = 0;
    const runDeadline = Date.now() + timeoutMs;
    while (
      Date.now() < runDeadline
      && visibleTurnCount < targetVisibleTurns
      && (!runUntilInitialBeatCompletes || !initialBeatCompleted)
    ) {
      const view = (await request(baseUrl, `/api/v1/worlds/${roomId}`)).view;
      const context = view.contexts.find((item) => item.id === "five-elements-mountain");
      assert(context, "WorldView 缺少 Galgame Context。");
      initialBeatId ??= view.narrative?.beats?.find((beat) => beat.status === "running")?.id;
      initialBeatCompleted = Boolean(initialBeatId && view.narrative?.beats?.some((beat) => (
        beat.id === initialBeatId && beat.status === "completed"
      )));
      if (runUntilInitialBeatCompletes && initialBeatCompleted) break;

      if (context.playerProposal) {
        const proposal = context.playerProposal;
        const option = proposal.suggestions?.[0] ?? proposal.autoPerformance;
        assert(option?.performance, "玩家回合没有生成可用提案。");
        const adversarialTurn = adversarialTurns[playerProposals.length]
          ?? (playerProposals.length === 0 && (adversarialPlayerMessage || adversarialPlayerAction)
            ? { message: adversarialPlayerMessage, action: adversarialPlayerAction }
            : undefined);
        const useAdversarialInput = Boolean(adversarialTurn?.message || adversarialTurn?.action);
        const selectedPerformance = useAdversarialInput
          ? {
              ...(adversarialTurn?.message ? { message: adversarialTurn.message } : {}),
              ...(adversarialTurn?.action ? { action: adversarialTurn.action } : {}),
            }
          : option.performance;
        playerProposals.push({
          id: proposal.id,
          kind: proposal.kind,
          choiceId: proposal.choiceId,
          prompt: proposal.prompt,
          suggestions: proposal.suggestions,
          autoPerformance: proposal.autoPerformance,
          selected: useAdversarialInput
            ? { label: "adversarial-input", performance: selectedPerformance }
            : option,
        });
        await request(baseUrl, `/api/v1/worlds/${roomId}/player-turn`, {
          method: "POST",
          body: {
            contextId: context.id,
            actorId: "traveler",
            proposalId: proposal.id,
            performance: selectedPerformance,
          },
        });
        playerTurnObserved = true;
        console.log(`[galgame-e2e] player chose: ${useAdversarialInput ? "adversarial-input" : option.label}`);
        await delay(150);
        continue;
      }

      const presentation = context.presentationTurn;
      if (presentation?.status === "waiting_ack") {
        const newEntries = view.entries
          .filter((entry) => entry.sequence > lastEntrySequence)
          .sort((left, right) => left.sequence - right.sequence);
        const usageBeforeHold = usageRecords(observations).length;
        const requiredHoldMs = presentation.acknowledgeAfter == null
          ? holdMs
          : Math.max(holdMs, presentation.acknowledgeAfter - Date.now() + 50);
        await delay(requiredHoldMs);
        const usageAfterHold = usageRecords(observations).length;

        turns.push({
          index: visibleTurnCount + 1,
          participant: presentation.participant,
          turnToken: presentation.turnToken,
          entryIds: [...presentation.entryIds],
          entries: newEntries.map(publicEntry),
          providerCallsDuringHold: usageAfterHold - usageBeforeHold,
        });
        for (const entry of newEntries) {
          console.log(`[galgame-e2e] ${entry.actorName || (entry.kind === "narration" ? "旁白" : entry.kind)}: ${entry.text}`);
          lastEntrySequence = Math.max(lastEntrySequence, entry.sequence);
        }

        await request(baseUrl, `/api/v1/worlds/${roomId}/presentation/ack`, {
          method: "POST",
          body: { contextId: context.id, turnToken: presentation.turnToken },
        });
        visibleTurnCount += 1;
        continue;
      }

      const errors = observations.filter((item) => (
        item.kind === "world_notification"
        && ["director.error", "narrator.error", "presentation.error", "world.error"].includes(item.notification?.type)
      ));
      assert(errors.length === 0, `运行出现错误通知：${errors.map((item) => JSON.stringify(item.notification)).join(" | ")}`);
      await delay(250);
    }

    const finalView = (await request(baseUrl, `/api/v1/worlds/${roomId}`)).view;
    const usage = summarizeUsage(observations);
    const errors = observations.filter((item) => (
      item.kind === "world_notification"
      && ["director.error", "narrator.error", "presentation.error", "world.error"].includes(item.notification?.type)
    ));
    const artifact = {
      schemaVersion: 1,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      roomId,
      world: finalView.world,
      imageFallbackVerified,
      playerTurnObserved,
      initialBeatId,
      initialBeatCompleted,
      playerProposals,
      turns,
      entries: finalView.entries.map(publicEntry),
      narrative: finalView.narrative,
      usage,
      usageRecords: usageRecords(observations),
      notificationTypes: unique(observations.filter((item) => item.kind === "world_notification").map((item) => item.notification.type)),
    };
    const artifactPath = await writeArtifact(artifact);

    console.log(`[galgame-e2e] usage calls=${usage.calls} tokens=${usage.totalTokens} cache=${formatPercent(usage.cacheHitRate)}`);
    console.log(`[galgame-e2e] artifact=${artifactPath}`);

    if (runUntilInitialBeatCompletes) {
      assert(initialBeatCompleted, `首个 Beat 在 ${turns.length} 个可见演出棒后仍未完成。`);
    } else {
      assert(turns.length >= targetVisibleTurns, `只完成 ${turns.length}/${targetVisibleTurns} 个可见演出棒。`);
    }
    assert(playerTurnObserved, "真实演出没有进入玩家提案回合。");
    const spokenActorIds = new Set(turns
      .flatMap((turn) => turn.entries)
      .filter((entry) => entry.kind === "character")
      .map((entry) => entry.actorId));
    assert(spokenActorIds.has("wukong"), "孙悟空没有获得有效角色回合。");
    assert(spokenActorIds.has("sanzang"), "唐三藏没有获得有效角色回合，玩家交棒可能仍回错对象。");

    assert(errors.length === 0, `真实演出产生 ${errors.length} 条错误通知。`);
    assert(usage.calls > 0, "真实演出没有 Provider 用量记录。");

    console.log(`[galgame-e2e] PASS turns=${turns.length} player=${playerTurnObserved}`);
  } finally {
    if (roomId && baseUrl) {
      try { await request(baseUrl, `/api/v1/worlds/${roomId}/stop`, { method: "POST" }); } catch { /* cleanup */ }
    }
    await stream?.close();
    if (child?.exitCode == null) {
      child.kill("SIGTERM");
      await delay(500);
      if (child.exitCode == null) child.kill("SIGKILL");
    }
  }
}

class SseCapture {
  constructor(response, controller, sink) {
    this.controller = controller;
    this.reader = response.body.getReader();
    this.decoder = new TextDecoder();
    this.buffer = "";
    this.sink = sink;
    this.pumpPromise = this.pump();
  }

  static async open(url, sink) {
    const controller = new AbortController();
    const response = await fetch(url, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
    assert(response.ok && response.body, `SSE 连接失败（HTTP ${response.status}）。`);
    return new SseCapture(response, controller, sink);
  }

  async pump() {
    try {
      while (true) {
        const chunk = await this.reader.read();
        if (chunk.done) return;
        this.buffer += this.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
        let separator;
        while ((separator = this.buffer.indexOf("\n\n")) >= 0) {
          const block = this.buffer.slice(0, separator);
          this.buffer = this.buffer.slice(separator + 2);
          const parsed = parseSseBlock(block);
          if (parsed) this.sink.push(parsed);
        }
      }
    } catch (error) {
      if (!this.controller.signal.aborted) throw error;
    }
  }

  async close() {
    this.controller.abort();
    try { await this.reader.cancel(); } catch { /* already closed */ }
    try { await this.pumpPromise; } catch { /* surfaced by assertions */ }
  }
}

async function request(baseUrl, path, options = {}) {
  const response = await requestRaw(baseUrl, path, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${path} 请求失败（HTTP ${response.status}）：${response.payload?.message || response.payload?.code || "unknown"}`);
  }
  return response.payload;
}

async function requestRaw(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* status assertion reports it */ }
  return { status: response.status, payload };
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return await request(baseUrl, "/healthz"); } catch { await delay(200); }
  }
  throw new Error("等待真实服务端健康检查超时。");
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

function parseSseBlock(block) {
  let sequence;
  let kind;
  const data = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const index = line.indexOf(":");
    const field = index >= 0 ? line.slice(0, index) : line;
    const value = index >= 0 ? line.slice(index + 1).trimStart() : "";
    if (field === "id") sequence = Number(value);
    if (field === "event") kind = value;
    if (field === "data") data.push(value);
  }
  if (!kind || data.length === 0) return undefined;
  return { sequence, kind, ...JSON.parse(data.join("\n")) };
}

function usageRecords(observations) {
  return observations.filter((item) => item.kind === "usage_recorded").map((item) => item.record);
}

function summarizeUsage(observations) {
  const records = usageRecords(observations);
  const cacheHits = records.reduce((sum, record) => sum + Number(record.cacheHitInputTokens || 0), 0);
  const inputTokens = records.reduce((sum, record) => sum + Number(record.inputTokens || 0), 0);
  const byRole = {};
  for (const record of records) {
    const role = record.providerRole || "unknown";
    byRole[role] ??= { calls: 0, tokens: 0 };
    byRole[role].calls += 1;
    byRole[role].tokens += Number(record.totalTokens || 0);
  }
  return {
    calls: records.length,
    inputTokens,
    outputTokens: records.reduce((sum, record) => sum + Number(record.outputTokens || 0), 0),
    totalTokens: records.reduce((sum, record) => sum + Number(record.totalTokens || 0), 0),
    cacheHitInputTokens: cacheHits,
    cacheHitRate: inputTokens > 0 ? cacheHits / inputTokens : 0,
    byRole,
  };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    sequence: entry.sequence,
    kind: entry.kind,
    actorId: entry.actorId,
    actorName: entry.actorName,
    text: entry.text,
    occurredAt: entry.occurredAt,
  };
}

async function writeArtifact(value) {
  await mkdir(artifactRoot, { recursive: true });
  const path = join(artifactRoot, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function requiredString(value, label) {
  assert(typeof value === "string" && value.length > 0, `响应缺少 ${label}。`);
  return value;
}

function rememberOutput(buffer, chunk) {
  const text = String(chunk).replace(/\s+/g, " ").trim();
  if (text) buffer.push(text.slice(0, 400));
  if (buffer.length > 10) buffer.shift();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAdversarialTurns(value) {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value);
  assert(Array.isArray(parsed), "GALGAME_E2E_ADVERSARIAL_TURNS 必须是 JSON 数组。");
  return parsed.map((turn, index) => {
    assert(turn && typeof turn === "object" && !Array.isArray(turn), `荒谬输入 #${index + 1} 必须是对象。`);
    const message = typeof turn.message === "string" && turn.message.trim() ? turn.message.trim() : undefined;
    const action = typeof turn.action === "string" && turn.action.trim() ? turn.action.trim() : undefined;
    assert(message || action, `荒谬输入 #${index + 1} 必须包含 message 或 action。`);
    return { message, action };
  });
}

function unique(values) {
  return [...new Set(values)];
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

run().catch((error) => {
  console.error(`[galgame-e2e] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
