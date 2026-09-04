import type { ProviderProtocol, WebResearchProtocol } from "../../contracts/provider.js";

type ProviderWireProtocol = ProviderProtocol | WebResearchProtocol;

const PROVIDER_ERROR_CODES = [
  "provider_auth_failed",
  "provider_quota_exceeded",
  "provider_rate_limited",
  "provider_timeout",
  "provider_unsupported",
  "provider_invalid_request",
  "provider_server_error",
  "provider_request_failed",
] as const;

export type ProviderErrorCode = typeof PROVIDER_ERROR_CODES[number];

export function isProviderErrorCode(value: unknown): value is ProviderErrorCode {
  return typeof value === "string"
    && (PROVIDER_ERROR_CODES as readonly string[]).includes(value);
}

export class ProviderRequestError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly protocol?: ProviderWireProtocol;
  readonly provider?: string;
  readonly model?: string;

  constructor(input: {
    code: ProviderErrorCode;
    message: string;
    status?: number;
    retryable?: boolean;
    protocol?: ProviderWireProtocol;
    provider?: string;
    model?: string;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "ProviderRequestError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? isRetryableCode(input.code);
    this.protocol = input.protocol;
    this.provider = input.provider;
    this.model = input.model;
  }
}

export function normalizeProviderError(
  error: unknown,
  context: {
    protocol: ProviderWireProtocol;
    provider?: string;
    model?: string;
  },
): ProviderRequestError {
  if (error instanceof ProviderRequestError) return error;
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : String(error);
  const code = providerErrorCode(status, message);
  return new ProviderRequestError({
    code,
    status,
    message: publicProviderErrorMessage(code),
    protocol: context.protocol,
    provider: context.provider,
    model: context.model,
    cause: error,
  });
}

export function publicProviderErrorMessage(code: ProviderErrorCode): string {
  switch (code) {
    case "provider_auth_failed": return "模型 API Key 无效或没有权限。";
    case "provider_quota_exceeded": return "模型服务额度不足或余额不足。";
    case "provider_rate_limited": return "模型服务请求过于频繁，请稍后重试。";
    case "provider_timeout": return "模型请求超时，请检查网络、模型和服务商状态。";
    case "provider_unsupported": return "当前模型或协议不支持此项能力。";
    case "provider_invalid_request": return "模型服务拒绝了请求参数，请检查模型和协议配置。";
    case "provider_server_error": return "模型服务暂时不可用，请稍后重试。";
    default: return "模型请求失败，请检查连接配置后重试。";
  }
}

function providerErrorCode(status: number | undefined, message: string): ProviderErrorCode {
  const lower = message.toLowerCase();
  if (status === 401 || status === 403 || /unauthorized|invalid api key|authentication/.test(lower)) {
    return "provider_auth_failed";
  }
  if (status === 402 || /insufficient|quota|credit|余额|额度|billing/.test(lower)) {
    return "provider_quota_exceeded";
  }
  if (status === 429 || /rate.?limit|too many requests/.test(lower)) return "provider_rate_limited";
  if (/timeout|timed out|aborted|aborterror|etimedout/.test(lower)) return "provider_timeout";
  if (status === 404 || /unsupported|not support|not found|unknown model/.test(lower)) {
    return "provider_unsupported";
  }
  if (status === 400 || /invalid parameter/.test(lower)) return "provider_invalid_request";
  if (status !== undefined && status >= 500) return "provider_server_error";
  return "provider_request_failed";
}

function isRetryableCode(code: ProviderErrorCode): boolean {
  return code === "provider_timeout"
    || code === "provider_rate_limited"
    || code === "provider_server_error";
}

function statusOf(error: unknown): number | undefined {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  return typeof record?.status === "number" ? record.status : undefined;
}
