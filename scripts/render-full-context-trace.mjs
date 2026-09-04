import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const inputs = process.argv.slice(2);
if (inputs.length === 0) throw new Error("Provide at least one debug JSONL path.");

const scenarios = inputs.map((path) => {
  const entries = readFileSync(resolve(path), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    path: resolve(path),
    roomId: entries[0]?.roomId,
    worldId: entries[0]?.worldId,
    worldName: entries[0]?.worldName,
    events: entries.map((entry) => entry.event),
  };
});

const outputDirectory = resolve(".artifacts/full-context-trace");
mkdirSync(outputDirectory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const reportPath = resolve(outputDirectory, `context-report-${stamp}.md`);
const jsonPath = resolve(outputDirectory, `context-report-${stamp}.json`);

writeFileSync(jsonPath, JSON.stringify({ generatedAt: Date.now(), scenarios }, null, 2), "utf8");
writeFileSync(reportPath, renderReport(scenarios, jsonPath), "utf8");
console.log(JSON.stringify({ reportPath, jsonPath }, null, 2));

function renderReport(values, rawPath) {
  const lines = [
    "# ChatVerse 本地真实 API 全上下文追踪",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    `完整合并 JSON：${rawPath}`,
    "",
    "说明：这里展示的是实际送入 Provider 的 Prompt 和实际返回正文。API Key、请求头和环境变量不在日志中。",
    "",
  ];
  values.forEach((scenario, index) => renderScenario(lines, scenario, index + 1));
  return `${lines.join("\n")}\n`;
}

function renderScenario(lines, scenario, scenarioIndex) {
  const counts = countByType(scenario.events);
  lines.push(
    `# 场景 ${scenarioIndex}：${scenario.worldName ?? "未命名世界"}`,
    "",
    `- roomId: ${scenario.roomId}`,
    `- worldId: ${scenario.worldId}`,
    `- Debug 事件：${scenario.events.length}`,
    `- Director Prompt：${counts["director.prompt"] ?? 0}`,
    `- Beat recorded/completed：${counts["narrative.beat.recorded"] ?? 0}/${counts["narrative.beat.completed"] ?? 0}`,
    `- Narrator Prompt/response：${counts["narrator.prompt"] ?? 0}/${counts["narrator.response"] ?? 0}`,
    `- Narrator turn selected：${counts["narrator.turn_selected"] ?? 0}`,
    `- Actor Prompt/response：${counts["character.prompt_built"] ?? 0}/${counts["character.response_completed"] ?? 0}`,
    "",
  );

  renderTimeline(lines, scenario.events);
  renderDirectorCalls(lines, scenario.events);
  renderBeats(lines, scenario.events);
  renderNarratorCalls(lines, scenario.events);
  renderWakeMessages(lines, scenario.events);
  renderActorCalls(lines, scenario.events);
}

function renderTimeline(lines, events) {
  const selected = events.filter((event) => /^(director\.|narrator\.|narrative\.beat|actor\.wake_|character\.|context\.(message|action)\.committed|presentation\.)/.test(event.type));
  lines.push("## 关键时序", "", "| Debug Seq | 类型 | Actor | 摘要 |", "|---:|---|---|---|");
  for (const event of selected) {
    lines.push(`| ${event.sequence} | ${event.type} | ${event.actorId ?? ""} | ${escapeCell(eventSummary(event))} |`);
  }
  lines.push("");
}

function renderDirectorCalls(lines, events) {
  lines.push("## Director 上下文实例", "");
  const prompts = positions(events, "director.prompt");
  if (prompts.length === 0) lines.push("无。", "");
  prompts.forEach((position, index) => {
    const event = events[position];
    const nextPosition = prompts[index + 1] ?? events.length;
    const related = events.slice(position + 1, nextPosition);
    const response = related.find((item) => item.type === "director.response");
    const tools = related.filter((item) => item.type === "director.tool_result");
    lines.push(`### Director 调用 ${index + 1} · Debug #${event.sequence}`, "", "#### System Prompt", "");
    block(lines, event.payload.systemPrompt ?? "(未开启 Prompt trace)", "text");
    lines.push("", "#### User Prompt", "");
    block(lines, event.payload.userPrompt ?? "(未开启 Prompt trace)", "text");
    lines.push("", "#### 原始响应", "");
    block(lines, response?.payload ?? { missing: true }, "json");
    lines.push("", "#### Tool Results", "");
    block(lines, tools.map((item) => ({ sequence: item.sequence, payload: item.payload })), "json");
    lines.push("");
  });
}

function renderBeats(lines, events) {
  lines.push("## Beat 实例", "");
  const beatEvents = events.filter((event) => event.type === "narrative.beat.recorded" || event.type === "narrative.beat.completed");
  if (beatEvents.length === 0) lines.push("无。", "");
  beatEvents.forEach((event, index) => {
    lines.push(`### Beat ${index + 1} · ${event.type} · Debug #${event.sequence}`, "");
    block(lines, event.payload.payload ?? event.payload, "json");
    lines.push("");
  });
}

function renderNarratorCalls(lines, events) {
  lines.push("## Narrator 上下文与结果实例", "");
  const prompts = positions(events, "narrator.prompt");
  if (prompts.length === 0) lines.push("无。", "");
  prompts.forEach((position, index) => {
    const event = events[position];
    const nextPosition = prompts[index + 1] ?? events.length;
    const related = events.slice(position + 1, nextPosition);
    const response = related.find((item) => item.type === "narrator.response");
    const selected = related.filter((item) => item.type === "narrator.turn_selected");
    const completed = related.find((item) => item.type === "narrator.completed");
    lines.push(`### Narrator 调用 ${index + 1} · Debug #${event.sequence}`, "", "#### System Prompt", "");
    block(lines, event.payload.systemPrompt ?? "(未开启 Prompt trace)", "text");
    lines.push("", "#### User Prompt（本轮完整上下文）", "");
    block(lines, event.payload.userPrompt ?? "(未开启 Prompt trace)", "text");
    lines.push("", "#### 原始 JSON 响应", "");
    block(lines, response?.payload.response ?? { missing: true }, typeof response?.payload.response === "string" ? "json" : "json");
    lines.push("", "#### 本轮选择与 wake", "");
    block(lines, {
      selections: selected.map((item) => ({ sequence: item.sequence, ...item.payload })),
      completed: completed?.payload,
    }, "json");
    lines.push("");
  });
}

function renderWakeMessages(lines, events) {
  lines.push("## 每次 Narrator wake 消息", "");
  const wakes = events.filter((event) => (
    event.type === "actor.wake_enqueued" &&
    event.payload.source === "narrator" &&
    typeof event.payload.contextId === "string"
  ));
  if (wakes.length === 0) lines.push("无。", "");
  wakes.forEach((event, index) => {
    lines.push(`### Wake ${index + 1} · Debug #${event.sequence} · actor=${event.actorId ?? event.payload.characterName ?? "unknown"}`, "");
    const eventIndex = events.indexOf(event);
    const selection = events
      .map((candidate, candidateIndex) => ({ candidate, distance: Math.abs(candidateIndex - eventIndex) }))
      .filter(({ candidate, distance }) => (
        distance <= 5 &&
        candidate.type === "narrator.turn_selected" &&
        candidate.payload.participant?.type === "actor" &&
        candidate.payload.participant.actorId === event.payload.actorId
      ))
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;
    const sessionWake = [...events.slice(0, events.indexOf(event))].reverse().find((candidate) => (
      candidate.type === "actor.wake_enqueued" &&
      candidate.payload.source === "narrator" &&
      typeof candidate.payload.contextId !== "string" &&
      candidate.actorId === event.payload.actorId
    ));
    block(lines, {
      ...event.payload,
      guidance: selection?.payload.reason,
      deliveredReason: event.payload.reason ?? sessionWake?.payload.reason,
      requiresReply: event.payload.requiresReply ?? sessionWake?.payload.requiresReply,
    }, "json");
    lines.push("");
  });
}

function renderActorCalls(lines, events) {
  lines.push("## Actor 上下文实例", "");
  const prompts = positions(events, "character.prompt_built");
  if (prompts.length === 0) lines.push("无。", "");
  prompts.forEach((position, index) => {
    const event = events[position];
    const nextPosition = prompts[index + 1] ?? events.length;
    const related = events.slice(position + 1, nextPosition);
    const response = related.find((item) => item.type === "character.response_completed" && (
      !event.actorId || item.actorId === event.actorId
    ));
    const precedingWake = [...events.slice(0, position)].reverse().find((item) => (
      item.type === "actor.wake_enqueued" &&
      item.payload.source === "narrator" &&
      typeof item.payload.contextId === "string" &&
      (!event.actorId || item.actorId === event.actorId)
    ));
    lines.push(`### Actor 调用 ${index + 1} · ${event.payload.characterName ?? event.actorId ?? "unknown"} · Debug #${event.sequence}`, "", "#### 对应 wake", "");
    block(lines, precedingWake ? { sequence: precedingWake.sequence, actorId: precedingWake.actorId, ...precedingWake.payload } : { missing: true }, "json");
    lines.push("", "#### System Prompt", "");
    block(lines, event.payload.systemPrompt ?? "(未开启 Prompt trace)", "text");
    lines.push("", "#### User Prompt（角色本轮完整上下文）", "");
    block(lines, event.payload.userPrompt ?? "(未开启 Prompt trace)", "text");
    lines.push("", "#### 原始决策响应", "");
    block(lines, response?.payload.message ?? { missing: true }, "json");
    lines.push("");
  });
}

function positions(events, type) {
  const result = [];
  events.forEach((event, index) => { if (event.type === type) result.push(index); });
  return result;
}

function countByType(events) {
  return events.reduce((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
}

function eventSummary(event) {
  const payload = event.payload ?? {};
  if (event.type === "narrator.turn_selected") return `${JSON.stringify(payload.participant)} ${payload.reason ?? ""}`;
  if (event.type === "actor.wake_enqueued") return `${payload.source ?? ""} ${payload.reason ?? payload.result ?? ""}`;
  if (event.type === "context.message.committed") return payload.payload?.message?.message ?? "";
  if (event.type === "context.action.committed") return payload.payload?.action?.action ?? "";
  if (event.type === "narrative.beat.recorded") return payload.payload?.beat?.title ?? "";
  if (event.type === "narrative.beat.completed") return payload.payload?.beat?.outcome ?? "";
  if (event.type.endsWith(".prompt")) return "完整 Prompt 见下文";
  if (event.type.endsWith(".response")) return "完整响应见下文";
  return JSON.stringify(payload).slice(0, 240);
}

function block(lines, value, language) {
  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  lines.push(`\`\`\`\`${language}`, rendered, "\`\`\`\`");
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
