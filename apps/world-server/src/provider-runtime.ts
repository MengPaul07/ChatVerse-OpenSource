import type {
  ChatProvider,
  WebResearchProvider,
} from "@chatverse/core";
import type { ProviderFactory, ProviderRequestConfig } from "./provider-config.js";
import type { ProviderPair } from "./rooms/contracts.js";

/**
 * Provider instances are normally created once for a room or authoring
 * session.  BYOK settings, however, are sent with every browser request and
 * can change while that runtime is still alive.  These delegating providers
 * keep the engine's references stable while allowing the request-scoped
 * implementation (and its base URL) to be replaced safely.
 */
export interface MutableProviderPair extends ProviderPair {
  replace(next: ProviderPair): void;
}

export class ProviderRuntime {
  readonly providers: MutableProviderPair;
  private providerConfigKey: string | undefined;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    initial: ProviderPair,
    private readonly providerFactory: ProviderFactory,
    initialConfig?: ProviderRequestConfig,
  ) {
    this.providers = createMutableProviderPair(initial);
    this.providerConfigKey = providerConfigKey(initialConfig);
  }

  /**
   * Apply a request's provider settings before it can start another model
   * operation.  Calls are serialized so concurrent requests cannot replace a
   * provider halfway through another replacement.
   */
  update(config?: ProviderRequestConfig): Promise<void> {
    if (!config) return this.updateQueue;
    const nextKey = providerConfigKey(config);
    if (nextKey === this.providerConfigKey) return this.updateQueue;

    const update = this.updateQueue.then(async () => {
      if (nextKey === this.providerConfigKey) return;
      const next = await this.providerFactory(config);
      this.providers.replace(next);
      this.providerConfigKey = nextKey;
    });
    // A failed update must not permanently poison the queue.  The caller of
    // this invocation still receives the original rejection.
    this.updateQueue = update.catch(() => undefined);
    return update;
  }
}

function createMutableProviderPair(initial: ProviderPair): MutableProviderPair {
  const director = mutableChatProvider(initial.directorProvider);
  const character = mutableChatProvider(initial.characterProvider);
  const authoring = mutableChatProvider(initial.authoringProvider ?? initial.directorProvider);
  const research = mutableResearchProvider(initial.researchProvider);

  return {
    directorProvider: director.provider,
    characterProvider: character.provider,
    authoringProvider: authoring.provider,
    researchProvider: research.provider,
    replace(next) {
      director.replace(next.directorProvider);
      character.replace(next.characterProvider);
      authoring.replace(next.authoringProvider ?? next.directorProvider);
      research.replace(next.researchProvider);
    },
  };
}

function mutableChatProvider(initial: ChatProvider): {
  provider: ChatProvider;
  replace(next: ChatProvider): void;
} {
  let current = initial;
  return {
    provider: {
      get profile() {
        return current.profile;
      },
      complete: (params) => current.complete(params),
      stream: async function* stream(params) {
        for await (const delta of current.stream(params)) yield delta;
      },
      chat: (params) => current.chat(params),
    },
    replace(next) {
      current = next;
    },
  };
}

function mutableResearchProvider(initial: WebResearchProvider | undefined): {
  provider: WebResearchProvider & { available: boolean };
  replace(next: WebResearchProvider | undefined): void;
} {
  let current = initial;
  const provider = {
    get profile() {
      return current?.profile;
    },
    get available(): boolean {
      return current !== undefined;
    },
    async search(params: Parameters<WebResearchProvider["search"]>[0]) {
      if (!current) throw new Error("research_provider_not_configured");
      return current.search(params);
    },
    replace(next: WebResearchProvider | undefined) {
      current = next;
    },
  };
  return { provider, replace: provider.replace };
}

export function providerConfigKey(config?: ProviderRequestConfig): string | undefined {
  if (!config) return undefined;
  return [
    config.protocol,
    config.providerName,
    config.apiKey,
    config.baseURL,
    config.model,
    config.directorModel,
    config.characterModel,
    config.authoringModel,
    config.research?.protocol,
    config.research?.providerName,
    config.research?.apiKey,
    config.research?.baseURL,
    config.research?.model,
    JSON.stringify(config.research?.options ?? {}),
    JSON.stringify(config.modelProfile ?? {}),
    JSON.stringify(config.providerOptions ?? {}),
  ].map((value) => value?.trim() ?? "").join("\u0000");
}
