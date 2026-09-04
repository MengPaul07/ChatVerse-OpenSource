import type { ProviderPair } from "./rooms/contracts.js";
import type {
  ProviderModelProfile,
  ProviderProtocol,
  WebResearchProtocol,
} from "@chatverse/core";

export interface ResearchProviderRequestConfig {
  protocol: WebResearchProtocol;
  providerName?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  options?: Record<string, unknown>;
}

export interface ProviderRequestConfig {
  /** A request-scoped credential. It is never serialized into a room or archive. */
  protocol?: ProviderProtocol;
  providerName?: string;
  apiKey?: string;
  baseURL?: string;
  /** Shared model used by all roles when role-specific models are absent. */
  model?: string;
  directorModel?: string;
  characterModel?: string;
  authoringModel?: string;
  providerOptions?: Record<string, unknown>;
  /** PI-style metadata for the selected concrete model, without credentials. */
  modelProfile?: ProviderModelProfile;
  research?: ResearchProviderRequestConfig;
}

export type ProviderFactory = (
  config?: ProviderRequestConfig,
) => ProviderPair | Promise<ProviderPair>;

export const PROVIDER_KEY_HEADER = "x-chatverse-api-key";
export const PROVIDER_BASE_URL_HEADER = "x-chatverse-api-base-url";
export const PROVIDER_MODEL_HEADER = "x-chatverse-model";
export const PROVIDER_RESEARCH_MODEL_HEADER = "x-chatverse-research-model";
export const RESEARCH_PROVIDER_KEY_HEADER = "x-chatverse-research-api-key";
export const RESEARCH_PROVIDER_BASE_URL_HEADER = "x-chatverse-research-api-base-url";
export const RESEARCH_PROVIDER_PROTOCOL_HEADER = "x-chatverse-research-protocol";
export const RESEARCH_PROVIDER_NAME_HEADER = "x-chatverse-research-provider";
export const RESEARCH_PROVIDER_OPTIONS_HEADER = "x-chatverse-research-provider-options";
export const PROVIDER_PROTOCOL_HEADER = "x-chatverse-protocol";
export const PROVIDER_NAME_HEADER = "x-chatverse-provider";
export const PROVIDER_OPTIONS_HEADER = "x-chatverse-provider-options";
export const PROVIDER_MODEL_PROFILE_HEADER = "x-chatverse-model-profile";

export function hasProviderCredential(
  config: ProviderRequestConfig | undefined,
  serverConfigured: boolean,
  customFactory: boolean,
): boolean {
  return Boolean(config?.apiKey) || serverConfigured || customFactory;
}
