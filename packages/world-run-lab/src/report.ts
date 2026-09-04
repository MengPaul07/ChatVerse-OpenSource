import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorldRunReport } from "./types.js";

export async function writeWorldRunArtifacts(
  report: WorldRunReport,
  outputDirectory: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  const directory = path.resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const baseName = safeFileName(report.runId);
  const jsonPath = path.join(directory, `${baseName}.json`);
  const markdownPath = path.join(directory, `${baseName}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderWorldRunReport(report), "utf8"),
  ]);
  return { jsonPath, markdownPath };
}

export function renderWorldRunReport(report: WorldRunReport): string {
  const token = report.metrics.tokenUsage;
  const lines = [
    `# ${report.scenario.name} Run Report`,
    "",
    `- 状态：${report.status === "passed" ? "通过" : "未通过"}`,
    `- Provider：${report.scenario.providerMode}`,
    `- 时间模式：${report.scenario.timeMode}`,
    `- Director 批次：${report.scenario.directorBatchSize}`,
    `- 运行时长：${formatDuration(report.durationMs)}`,
    `- WorldEvent：${report.metrics.eventCount} / 目标 ${report.scenario.targetEventCount}`,
    `- 冷恢复：${report.metrics.restoreCount}`,
    `- Token：${token.totalTokens}（输入 ${token.inputTokens}，输出 ${token.outputTokens}）`,
    `- 前缀缓存：命中 ${token.cacheHitInputTokens}，未命中 ${token.cacheMissInputTokens}（命中率 ${formatPercent(token.cacheHitRate)}）`,
    `- Token 效率：平均每请求输入 ${token.averageInputTokensPerRequest}，每事件总计 ${token.totalTokensPerEvent}`,
    `- Provider 延迟：平均 ${report.metrics.providerLatency.averageMs}ms，P95 ${report.metrics.providerLatency.p95Ms}ms`,
    `- Director：实际调用 ${report.metrics.director.callCount} 次，排程 ${report.metrics.director.scheduledCount} 次，批次排程 ${report.metrics.director.batchScheduleCount} 次，平均每次处理 ${report.metrics.director.averageEventsPerCall} 个事件`,
    `- Director 任务：${report.metrics.director.taskCount} 次，完成 ${report.metrics.director.taskCompleteCount}，部分完成 ${report.metrics.director.taskPartialCount}，空转 ${report.metrics.director.taskEmptyCount}，纠正 ${report.metrics.director.taskRetryCount} 次，完成率 ${formatPercent(report.metrics.director.taskCompletionRate)}，工具符合率 ${formatPercent(report.metrics.director.taskToolComplianceRate)}`,
    `- 稳定性：settle ${report.metrics.stability.settleCount} 次，超时 ${report.metrics.stability.timeoutCount}，卡死 ${report.metrics.stability.stallCount}，后台排空超时 ${report.metrics.stability.backgroundDrainTimeoutCount}，最大泵迭代 ${report.metrics.stability.maxPumpIterations}，停止后待处理任务 ${report.metrics.stability.finalPendingTasks}`,
    `- 请求生命周期：操作 ${report.operations.length} 次，最大并发 ${report.metrics.stability.maxConcurrentOperations}，最长 ${report.metrics.stability.maxOperationAgeMs}ms，结束时仍活跃 ${report.metrics.stability.activeOperationsAtFinish}`,
    `- Prompt 诊断：${report.promptTraces.length} 次请求，平均稳定前缀 ${averagePromptPrefix(report.promptTraces)}%`,
    "",
    "## 验收",
    "",
    ...report.checks.map((check) => (
      `- [${check.passed ? "x" : " "}] ${check.label}：${check.detail}`
    )),
    "",
    "## 事件分布",
    "",
    ...tableRows(report.metrics.eventsByType),
    "",
    "## Token 用途",
    "",
    ...token.byPurpose.map((item) => (
      `- ${item.key}：${item.totalTokens} tokens / ${item.requestCount} 次 / ${formatCache(item.cacheHitInputTokens, item.cacheMissInputTokens)}`
    )),
    "",
    "## Token 按模型",
    "",
    ...token.byModel.map((item) => (
      `- ${item.key}：${item.totalTokens} tokens / ${item.requestCount} 次 / ${formatCache(item.cacheHitInputTokens, item.cacheMissInputTokens)}`
    )),
    "",
    "## Prompt 缓存诊断",
    "",
    ...renderPromptDiagnostics(report),
    "",
    "## Director 工具",
    "",
    ...(Object.keys(report.metrics.toolUsage.byName).length
      ? Object.entries(report.metrics.toolUsage.byName)
        .sort(([, left], [, right]) => right - left)
        .map(([name, count]) => `- ${name}：${count}`)
      : ["- 无工具调用"]),
    "",
    "## Director 触发原因",
    "",
    ...tableRows(report.metrics.director.scheduleReasons),
    "",
    "## 请求生命周期",
    "",
    ...(report.operations.length
      ? report.operations.map((operation) => (
        `- ${operation.kind}${operation.actorId ? `/${operation.actorId}` : ""}：${operation.outcome}，${operation.durationMs}ms`
      ))
      : ["- 无已完成操作"]),
    "",
    "## Checkpoints",
    "",
    ...report.checkpoints.map((checkpoint) => (
      `- 请求序号 ${checkpoint.requestedSequence}，实际捕获 ${checkpoint.capturedSequence}，恢复=${checkpoint.restored ? "是" : "否"}`
    )),
    "",
    "## 对话摘录",
    "",
    ...report.transcript.slice(-30).map((entry) => (
      `- [${entry.sequence}] ${entry.speaker ?? entry.kind}：${entry.text.replace(/\s+/g, " ")}`
    )),
  ];
  if (report.errors.length) {
    lines.push("", "## 错误", "", ...report.errors.map((error) => `- ${error}`));
  }
  return `${lines.join("\n")}\n`;
}

function tableRows(values: Record<string, number>): string[] {
  return Object.entries(values)
    .sort(([, left], [, right]) => right - left)
    .map(([name, count]) => `- ${name}：${count}`);
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCache(hit: number, miss: number): string {
  const measured = hit + miss;
  return measured > 0
    ? `缓存 ${hit}/${measured}（${formatPercent(hit / measured)}）`
    : "缓存指标未知";
}

function renderPromptDiagnostics(report: WorldRunReport): string[] {
  if (!report.promptTraces.length) return ["- 无 Prompt 追踪记录"];
  const byPurpose = new Map<string, typeof report.promptTraces>();
  for (const trace of report.promptTraces) {
    const key = trace.purpose ?? trace.operation;
    const values = byPurpose.get(key) ?? [];
    values.push(trace);
    byPurpose.set(key, values);
  }
  return [...byPurpose.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([purpose, traces]) => {
      const comparable = traces.filter((trace) => trace.comparedToPrevious);
      const samples = comparable.length > 0 ? comparable : traces;
      const averageChars = Math.round(
        traces.reduce((sum, trace) => sum + trace.totalChars, 0) / traces.length,
      );
      const averageStable = Math.round(
        samples.reduce((sum, trace) => sum + trace.stablePrefixRate, 0) /
          samples.length * 10_000,
      ) / 100;
      const firstChanges = new Map<string, number>();
      for (const trace of comparable) {
        if (!trace.firstChangedSegment) continue;
        firstChanges.set(
          trace.firstChangedSegment,
          (firstChanges.get(trace.firstChangedSegment) ?? 0) + 1,
        );
      }
      const firstChangeSummary = [...firstChanges.entries()]
        .sort(([, left], [, right]) => right - left)
        .slice(0, 3)
        .map(([name, count]) => `${name}×${count}`)
        .join(", ") || "无变化位置";
      return `- ${purpose}：${traces.length} 次（可比较 ${comparable.length} 次），平均 ${averageChars} chars，平均稳定前缀 ${averageStable}%；首个变化：${firstChangeSummary}`;
    });
}

function averagePromptPrefix(
  traces: readonly { stablePrefixRate: number; comparedToPrevious: boolean }[],
): string {
  if (!traces.length) return "0.00";
  const comparable = traces.filter((trace) => trace.comparedToPrevious);
  const samples = comparable.length > 0 ? comparable : traces;
  return (samples.reduce((sum, trace) => sum + trace.stablePrefixRate, 0) / samples.length * 100)
    .toFixed(2);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
