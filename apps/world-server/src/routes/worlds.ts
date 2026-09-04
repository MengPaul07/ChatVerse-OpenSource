import type { IncomingMessage, ServerResponse } from "node:http";
import { compileWorldDraft } from "@chatverse/world-authoring";
import {
  assertWorldSourcesAvailable,
  groupCard,
  readJson,
  worldArchive,
  worldDraft,
  worldSourceProvider,
} from "../http/validation.js";
import { HttpError } from "../http/errors.js";
import { sendJson } from "../http/response.js";
import type { ProviderRequestConfig } from "../provider-config.js";
import type { WorldRoomRegistry } from "../rooms/registry.js";

const MAX_WORLD_REQUEST_BYTES = 96 * 1024 * 1024;

export async function handleWorldCreateRoute(input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  registry: WorldRoomRegistry;
  providerConfig?: ProviderRequestConfig;
  apiKeyConfigured: boolean;
  customProviderFactory: boolean;
}): Promise<boolean> {
  if (input.url.pathname !== "/api/v1/worlds" || input.request.method !== "POST") return false;
  if (!input.apiKeyConfigured && !input.customProviderFactory && !input.providerConfig?.apiKey) {
    throw new HttpError(503, "provider_not_configured", "当前没有可用的模型连接，请在设置中填写协议、API 地址、模型和 Key。");
  }
  const body = await readJson(input.request, MAX_WORLD_REQUEST_BYTES);
  const source = body.source && typeof body.source === "object" && !Array.isArray(body.source)
    ? body.source as Record<string, unknown>
    : undefined;
  if (!source) throw new HttpError(400, "invalid_world_source", "source 必须是 World 创建来源。");
  const sourceProvider = worldSourceProvider(source.bundles);
  let room;
  if (source.kind === "world_archive") {
    const archive = worldArchive(source.archive);
    assertWorldSourcesAvailable(archive.definition, sourceProvider);
    room = await input.registry.createArchiveRoom(archive, input.providerConfig, sourceProvider);
  } else if (source.kind === "world_draft") {
    const definition = compileWorldDraft(worldDraft(source.draft));
    assertWorldSourcesAvailable(definition, sourceProvider);
    room = await input.registry.createDefinitionRoom(
      definition,
      true,
      input.providerConfig,
      sourceProvider,
    );
  } else if (source.kind === "group_card") {
    room = await input.registry.createGroupRoom(groupCard(source.group), input.providerConfig);
  } else {
    throw new HttpError(400, "invalid_world_source", "不支持的 World 创建来源。");
  }
  sendJson(input.response, 201, {
    ok: true,
    roomId: room.id,
    view: room.view(),
    archive: room.archive(),
  });
  return true;
}
