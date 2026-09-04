import { isProviderErrorCode, type ProviderErrorCode } from "../adapters/providers/provider-errors.js";

export type BlockingProviderIssueKind =
  | "billing"
  | "authentication"
  | "permission"
  | "configuration";

export interface ProviderFailureDetails {
  status?: number;
  code?: string;
  message: string;
}

export interface BlockingProviderIssue extends ProviderFailureDetails {
  kind: BlockingProviderIssueKind;
  userMessage: string;
}

export function providerFailureDetails(error: unknown): ProviderFailureDetails {
  const record = isRecord(error) ? error : undefined;
  const nested = isRecord(record?.error) ? record.error : undefined;
  const status = numberValue(record?.status) ?? numberValue(record?.statusCode)
    ?? numberValue(nested?.status) ?? numberValue(nested?.statusCode);
  const code = stringValue(record?.code) ?? stringValue(nested?.code)
    ?? stringValue(record?.type) ?? stringValue(nested?.type);
  const rawMessage = error instanceof Error
    ? error.message
    : stringValue(record?.message) ?? stringValue(nested?.message) ?? String(error);
  return {
    status,
    code: code?.slice(0, 120),
    message: sanitizeProviderMessage(rawMessage),
  };
}

export function blockingProviderIssue(
  error: unknown | ProviderFailureDetails,
): BlockingProviderIssue | undefined {
  const details = isProviderFailureDetails(error) ? error : providerFailureDetails(error);
  const normalizedCode = isProviderErrorCode(details.code) ? details.code : undefined;
  const normalizedIssue = blockingIssueFromProviderCode(details, normalizedCode);
  if (normalizedIssue) return normalizedIssue;
  if (normalizedCode) return undefined;

  const searchable = `${details.code ?? ""} ${details.message}`.toLowerCase();
  const isQuotaFailure = matchesAny(searchable, [
    "insufficient_quota",
    "insufficient balance",
    "insufficient credit",
    "payment required",
    "billing",
    "quota exceeded",
    "quota exhausted",
    "余额不足",
    "额度不足",
    "欠费",
  ]);

  if (details.status === 402 || isQuotaFailure) {
    return {
      ...details,
      kind: "billing",
      userMessage: "模型服务余额不足或额度已用尽，请充值或更换 API Key 后再继续。",
    };
  }
  if (details.status === 401) {
    return {
      ...details,
      kind: "authentication",
      userMessage: "API Key 无效或已过期，请检查模型设置后再继续。",
    };
  }
  if (details.status === 403) {
    return {
      ...details,
      kind: "permission",
      userMessage: "当前 API Key 无权调用这个模型，请检查模型名称或账户权限。",
    };
  }
  if (
    details.status === 400 ||
    details.status === 404 ||
    details.status === 422 ||
    matchesAny(searchable, ["model_not_found", "unknown model", "invalid model"])
  ) {
    return {
      ...details,
      kind: "configuration",
      userMessage: "模型请求配置不可用，请检查接口地址和模型名称。",
    };
  }
  return undefined;
}

function blockingIssueFromProviderCode(
  details: ProviderFailureDetails,
  code: ProviderErrorCode | undefined,
): BlockingProviderIssue | undefined {
  if (!code) return undefined;
  if (code === "provider_quota_exceeded") {
    return {
      ...details,
      kind: "billing",
      userMessage: "模型服务余额不足或额度已用尽，请充值或更换 API Key 后再继续。",
    };
  }
  if (code === "provider_auth_failed") {
    return {
      ...details,
      kind: details.status === 403 ? "permission" : "authentication",
      userMessage: details.status === 403
        ? "当前 API Key 无权调用这个模型，请检查模型名称或账户权限。"
        : "API Key 无效或已过期，请检查模型设置后再继续。",
    };
  }
  if (code === "provider_invalid_request" || code === "provider_unsupported") {
    return {
      ...details,
      kind: "configuration",
      userMessage: "模型请求配置不可用，请检查接口地址和模型名称。",
    };
  }
  return undefined;
}

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1[redacted]")
    .slice(0, 500);
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function isProviderFailureDetails(value: unknown): value is ProviderFailureDetails {
  return isRecord(value) && typeof value.message === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
