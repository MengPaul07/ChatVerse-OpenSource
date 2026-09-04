import {
  ProviderRequestError,
  type ChatProvider,
  type WebResearchProvider,
} from "@chatverse/core";
import type { ProviderFactory } from "./provider-config.js";
import type { ProviderPair } from "./rooms/contracts.js";

export const DEFAULT_PROVIDER_CONCURRENCY_LIMIT = 256;

/** Process-wide, fail-fast protection for outbound model calls. */
export class ProviderConcurrencyGate {
  private active = 0;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Provider concurrency limit must be a positive integer.");
    }
  }

  get activeCount(): number {
    return this.active;
  }

  acquire(): () => void {
    if (this.active >= this.limit) {
      throw new ProviderRequestError({
        code: "provider_rate_limited",
        status: 429,
        retryable: true,
        message: "当前服务器的模型调用已满，请稍后重试。",
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
    };
  }
}

export function withProviderConcurrencyGate(
  factory: ProviderFactory,
  gate: ProviderConcurrencyGate,
): ProviderFactory {
  return async (config) => wrapProviderPair(await factory(config), gate);
}

function wrapProviderPair(pair: ProviderPair, gate: ProviderConcurrencyGate): ProviderPair {
  return {
    directorProvider: wrapChatProvider(pair.directorProvider, gate),
    characterProvider: wrapChatProvider(pair.characterProvider, gate),
    authoringProvider: pair.authoringProvider
      ? wrapChatProvider(pair.authoringProvider, gate)
      : undefined,
    researchProvider: pair.researchProvider
      ? wrapResearchProvider(pair.researchProvider, gate)
      : undefined,
  };
}

function wrapChatProvider(provider: ChatProvider, gate: ProviderConcurrencyGate): ChatProvider {
  return {
    get profile() {
      return provider.profile;
    },
    async complete(params) {
      const release = gate.acquire();
      try {
        return await provider.complete(params);
      } finally {
        release();
      }
    },
    async *stream(params) {
      const release = gate.acquire();
      try {
        for await (const delta of provider.stream(params)) yield delta;
      } finally {
        release();
      }
    },
    async chat(params) {
      const release = gate.acquire();
      try {
        return await provider.chat(params);
      } finally {
        release();
      }
    },
  };
}

function wrapResearchProvider(
  provider: WebResearchProvider,
  gate: ProviderConcurrencyGate,
): WebResearchProvider {
  return {
    get profile() {
      return provider.profile;
    },
    async search(params) {
      const release = gate.acquire();
      try {
        return await provider.search(params);
      } finally {
        release();
      }
    },
  };
}

export function providerConcurrencyLimitFromEnvironment(): number {
  const value = Number(process.env.CHATVERSE_PROVIDER_CONCURRENCY_LIMIT);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_PROVIDER_CONCURRENCY_LIMIT;
}
