import type { ChatProvider } from "../../contracts/provider.js";

export interface TimelineCuratorResult {
  summary: string;
  facts: string[];
}

export interface TimelineCuratorCheckpoint {
  summary: string;
  facts: readonly string[];
}

const TIMELINE_CURATOR_SYSTEM_PROMPT = [
  "你是世界时间线的归档员,负责把一批已提交的事件折叠成稳定的较早摘要。",
  "摘要必须保留:①因果链与已发生的确定结果;②关键数字、时间窗口、设备状态与人员状态;③角色已做出的承诺与决定;④尚未解决的未解问题。",
  "禁止:编造事件中没有的事实、把主张写成已确认事实、删除与后续剧情可能相关的硬事实。",
  "只输出一个 JSON 对象:{\"summary\":string,\"facts\":string[]}。facts 每项一条短事实,不超过 12 条。",
].join("\n");

export class TimelineCurator {
  private responseFormatSupported: boolean | undefined;

  constructor(private readonly provider: ChatProvider) {}

  async curate(
    rows: readonly string[],
    checkpoint?: TimelineCuratorCheckpoint,
    signal?: AbortSignal,
  ): Promise<TimelineCuratorResult> {
    const request = {
      systemPrompt: TIMELINE_CURATOR_SYSTEM_PROMPT,
      userPrompt: [
        "[已有时间线摘要]",
        checkpoint?.summary || "（无）",
        "",
        "[已有关键事实]",
        checkpoint?.facts?.length
          ? checkpoint.facts.map((fact) => `- ${fact}`).join("\n")
          : "（无）",
        "",
        "[待折叠事件]",
        ...rows,
        "[要求]",
        "把已有摘要、已有关键事实和新增事件合并为一份完整的替换版摘要与事实。不要只总结新增事件，也不要丢失已有摘要中仍然有效的事实。输出 4-8 句连续摘要与不超过 12 条关键事实。摘要用过去时，事实用陈述句，保留全部关键数字与状态。",
      ].join("\n"),
      maxTokens: 900,
      thinking: "disabled" as const,
      signal,
      requestContext: { purpose: "history_compression" as const },
    };
    const raw = await this.complete(request);
    try {
      return parseCuratorResult(raw);
    } catch (error) {
      const repaired = await this.complete({
        ...request,
        userPrompt: [
          request.userPrompt,
          "",
          "[输出修复]",
          `上一份输出无法解析：${errorMessage(error)}`,
          `上一份输出：${truncate(raw, 700)}`,
          "只返回完整 JSON：{\"summary\":string,\"facts\":string[]}。summary 不得为空，facts 必须是数组。",
        ].join("\n"),
      });
      return parseCuratorResult(repaired);
    }
  }

  private async complete(
    request: Omit<Parameters<ChatProvider["complete"]>[0], "responseFormat">,
  ): Promise<string> {
    if (this.responseFormatSupported === false) return this.provider.complete(request);
    try {
      const response = await this.provider.complete({
        ...request,
        responseFormat: { type: "json_object" },
      });
      this.responseFormatSupported = true;
      return response;
    } catch (error) {
      if (!isResponseFormatUnsupported(error)) throw error;
      this.responseFormatSupported = false;
      return this.provider.complete(request);
    }
  }
}

function parseCuratorResult(raw: string): TimelineCuratorResult {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidates = [text];
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  let parseError: unknown;
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      const summary = typeof value.summary === "string" ? value.summary.trim() : "";
      if (!summary) throw new Error("TimelineCurator requires a non-empty summary.");
      if (!Array.isArray(value.facts)) throw new Error("TimelineCurator facts must be an array.");
      const facts = [...new Set(value.facts
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => truncate(item, 240)))]
        .slice(0, 12);
      return { summary, facts };
    } catch (error) {
      parseError = error;
    }
  }
  throw parseError instanceof Error
    ? parseError
    : new Error("TimelineCurator returned invalid JSON.");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isResponseFormatUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const text = `${String(candidate.code ?? "")} ${String(candidate.message ?? "")}`;
  return (
    (status === 400 || status === 404 || status === 422) &&
    /(response.?format|json.?object|json.?mode)/i.test(text)
  );
}
