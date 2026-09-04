import type { IncomingMessage, ServerResponse } from "node:http";
import {
  normalizeProviderError,
  type ProviderProfile,
  type WebResearchProfile,
} from "@chatverse/core";
import {
  generateImage,
  imageProviderConfigFromRequest,
  testImageProvider,
  type ImageProviderConfig,
} from "../image-provider.js";
import {
  hasProviderCredential,
  type ProviderFactory,
  type ProviderRequestConfig,
} from "../provider-config.js";
import { HttpError, imageProviderHttpError } from "../http/errors.js";
import { sendJson } from "../http/response.js";
import { ImageProviderError } from "../image-providers/index.js";
import { PROVIDER_NOT_CONFIGURED_MESSAGE } from "../environment.js";
import {
  optionalImageReference,
  readJson,
  requiredString,
} from "../http/request-parsers.js";

export interface SystemRouteInput {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  providerConfig?: ProviderRequestConfig;
  imageProviderConfig?: ImageProviderConfig;
  providerFactory: ProviderFactory;
  apiKeyConfigured: boolean;
  customProviderFactory: boolean;
}

const MAX_IMAGE_REQUEST_BYTES = 15 * 1024 * 1024;

export async function handleSystemRoute(input: SystemRouteInput): Promise<boolean> {
  const {
    request,
    response,
    url,
    providerConfig,
    imageProviderConfig,
    providerFactory,
    apiKeyConfigured,
    customProviderFactory,
  } = input;
  if (url.pathname === "/healthz" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      service: "chatverse-world-server",
      providerConfigured: apiKeyConfigured || customProviderFactory,
      byokSupported: true,
    });
    return true;
  }

  if (url.pathname === "/api/v1/provider/test" && request.method === "POST") {
    assertProviderCredential(providerConfig, apiKeyConfigured, customProviderFactory);
    await readJson(request);
    let providers: Awaited<ReturnType<ProviderFactory>> | undefined;
    try {
      providers = await providerFactory(providerConfig);
      await providers.directorProvider.chat({
        messages: [
          { role: "system", content: "You are a connection test. Reply with OK only." },
          { role: "user", content: "Reply with OK only." },
        ],
        maxTokens: 8,
        thinking: "disabled",
        requestContext: { purpose: "other" },
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw providerHttpError(error, providers?.directorProvider.profile, providerConfig);
    }
    const profile = providers?.directorProvider.profile;
    sendJson(response, 200, {
      ok: true,
      model: profile?.model ?? providerConfig?.model,
      provider: profile?.providerName ?? providerConfig?.providerName,
      providerName: profile?.providerName ?? providerConfig?.providerName,
      protocol: profile?.protocol ?? providerConfig?.protocol ?? "openai-chat",
      capabilities: profile?.capabilities,
      modelProfile: profile?.modelProfile,
    });
    return true;
  }

  if (url.pathname === "/api/v1/provider/research-test" && request.method === "POST") {
    assertProviderCredential(providerConfig, apiKeyConfigured, customProviderFactory);
    await readJson(request);
    let providers: Awaited<ReturnType<ProviderFactory>> | undefined;
    try {
      providers = await providerFactory(providerConfig);
      if (!providers.researchProvider) {
        throw new HttpError(400, "provider_unsupported", "尚未配置独立的联网检索服务。 ");
      }
      const result = await providers.researchProvider.search({
        query: "ChatVerse 联网检索连接测试",
        purpose: "测试联网搜索能力",
        requestContext: { purpose: "world_authoring_research" },
      });
      const researchProfile = providers.researchProvider.profile;
      sendJson(response, 200, {
        ok: true,
        protocol: researchProfile?.protocol,
        providerName: researchProfile?.providerName,
        model: researchProfile?.model,
        sourceCount: result.sources.length,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw researchProviderHttpError(error, providers?.researchProvider?.profile);
    }
    return true;
  }

  if (url.pathname === "/api/v1/image-provider/test" && request.method === "POST") {
    if (!imageProviderConfig) {
      throw new HttpError(400, "image_provider_not_configured", "请完整填写图片 API 的地址、模型和 Key。");
    }
    await readJson(request);
    try {
      const result = await testImageProvider(imageProviderConfig);
      sendJson(response, 200, {
        ok: true,
        model: imageProviderConfig.model,
        protocol: imageProviderConfig.protocol,
        verification: result.verification,
      });
    } catch (error) {
      throw imageProviderHttpError("image_provider_connection_failed", error);
    }
    return true;
  }

  if (url.pathname === "/api/v1/images/generate" && request.method === "POST") {
    if (!imageProviderConfig) {
      throw new HttpError(400, "image_provider_not_configured", "请先配置图片模型。");
    }
    const body = await readJson(request, MAX_IMAGE_REQUEST_BYTES);
    const prompt = requiredString(body.prompt, "prompt", 8000);
    const size = requiredString(body.size, "size", 40);
    const referenceImage = optionalImageReference(body);
    try {
      const image = await generateImage(imageProviderConfig, {
        prompt,
        size,
        ...(referenceImage ? { referenceImage } : {}),
      });
      sendJson(response, 200, {
        ok: true,
        imageBase64: image.bytes.toString("base64"),
        mimeType: image.mimeType,
        model: image.model,
        revisedPrompt: image.revisedPrompt,
      });
    } catch (error) {
      throw imageProviderHttpError("image_generation_failed", error);
    }
    return true;
  }

  return false;
}

function researchProviderHttpError(
  error: unknown,
  profile: WebResearchProfile | undefined,
): HttpError {
  const normalized = normalizeProviderError(error, {
    protocol: profile?.protocol ?? "responses-web-search",
    provider: profile?.providerName,
    model: profile?.model,
  });
  const code = normalized.code === "provider_request_failed"
    ? "research_provider_connection_failed"
    : normalized.code;
  const status = code === "provider_auth_failed" ? 401
    : code === "provider_quota_exceeded" ? 402
      : code === "provider_rate_limited" ? 429
        : code === "provider_invalid_request" || code === "provider_unsupported" ? 400
          : code === "provider_timeout" ? 504
            : 502;
  return new HttpError(status, code, normalized.message);
}

function assertProviderCredential(
  config: ProviderRequestConfig | undefined,
  apiKeyConfigured: boolean,
  customProviderFactory: boolean,
): void {
  if (!hasProviderCredential(config, apiKeyConfigured, customProviderFactory)) {
    throw new HttpError(503, "provider_not_configured", PROVIDER_NOT_CONFIGURED_MESSAGE);
  }
}

function providerHttpError(
  error: unknown,
  profile: ProviderProfile | undefined,
  config: ProviderRequestConfig | undefined,
  fallbackCode = "provider_connection_failed",
): HttpError {
  const normalized = normalizeProviderError(error, {
    protocol: profile?.protocol ?? config?.protocol ?? "openai-chat",
    provider: profile?.providerName ?? config?.providerName,
    model: profile?.model ?? config?.model,
  });
  const code = normalized.code === "provider_request_failed" ? fallbackCode : normalized.code;
  const status = code === "provider_auth_failed" ? 401
    : code === "provider_quota_exceeded" ? 402
      : code === "provider_rate_limited" ? 429
        : code === "provider_invalid_request" || code === "provider_unsupported" ? 400
          : code === "provider_timeout" ? 504
            : code === "provider_server_error" ? 502 : 502;
  return new HttpError(status, code, normalized.message);
}

export function parseImageProviderConfig(request: IncomingMessage): ImageProviderConfig | undefined {
  try {
    return imageProviderConfigFromRequest(request);
  } catch (error) {
    if (error instanceof ImageProviderError) {
      throw new HttpError(400, "invalid_image_provider_config", error.message);
    }
    throw error;
  }
}
