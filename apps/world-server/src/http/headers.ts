import type { ServerResponse } from "node:http";
import {
  IMAGE_API_KEY_HEADER,
  IMAGE_BASE_URL_HEADER,
  IMAGE_MODEL_HEADER,
  IMAGE_PROTOCOL_HEADER,
} from "../image-provider.js";
import {
  PROVIDER_ACTOR_MODEL_HEADER,
  PROVIDER_DIRECTOR_MODEL_HEADER,
  PROVIDER_NARRATOR_MODEL_HEADER,
  PROVIDER_STUDIO_MODEL_HEADER,
  PROVIDER_RESEARCH_MODEL_HEADER,
  RESEARCH_PROVIDER_BASE_URL_HEADER,
  RESEARCH_PROVIDER_KEY_HEADER,
  RESEARCH_PROVIDER_NAME_HEADER,
  RESEARCH_PROVIDER_OPTIONS_HEADER,
  RESEARCH_PROVIDER_PROTOCOL_HEADER,
} from "../provider-config.js";

export function setCommonHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    `Content-Type, Last-Event-ID, X-ChatVerse-API-Key, X-ChatVerse-API-Base-URL, X-ChatVerse-Model, ${PROVIDER_DIRECTOR_MODEL_HEADER}, ${PROVIDER_NARRATOR_MODEL_HEADER}, ${PROVIDER_ACTOR_MODEL_HEADER}, ${PROVIDER_STUDIO_MODEL_HEADER}, X-ChatVerse-Protocol, X-ChatVerse-Provider, X-ChatVerse-Provider-Options, X-ChatVerse-Model-Profile, ${PROVIDER_RESEARCH_MODEL_HEADER}, ${RESEARCH_PROVIDER_KEY_HEADER}, ${RESEARCH_PROVIDER_BASE_URL_HEADER}, ${RESEARCH_PROVIDER_PROTOCOL_HEADER}, ${RESEARCH_PROVIDER_NAME_HEADER}, ${RESEARCH_PROVIDER_OPTIONS_HEADER}, ${IMAGE_API_KEY_HEADER}, ${IMAGE_BASE_URL_HEADER}, ${IMAGE_MODEL_HEADER}, ${IMAGE_PROTOCOL_HEADER}`,
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("X-Content-Type-Options", "nosniff");
}
