import type {
  ChatProvider,
  ProviderUsageObservation,
  TokenUsage,
  TokenUsageListener,
} from "../contracts/provider.js";
export type { ProviderUsageObservation } from "../contracts/provider.js";

/**
 * Adds passive usage observation without changing Provider results.
 * Adapters report exact usage through onUsage; chat() also has a response
 * fallback for custom Providers that only populate ChatResponse.usage.
 */
export function observeProviderUsage(
  provider: ChatProvider,
  observer: (observation: ProviderUsageObservation) => void,
): ChatProvider {
  return {
    get profile() {
      return provider.profile;
    },
    complete(params) {
      return provider.complete({
        ...params,
        onUsage: combineUsageListeners(
          params.onUsage,
          (usage) => observerSafely(observer, {
            operation: "complete",
            requestContext: params.requestContext,
            usage,
          }),
        ),
      });
    },

    stream(params) {
      return provider.stream({
        ...params,
        onUsage: combineUsageListeners(
          params.onUsage,
          (usage) => observerSafely(observer, {
            operation: "stream",
            requestContext: params.requestContext,
            usage,
          }),
        ),
      });
    },

    async chat(params) {
      let callbackReported = false;
      const response = await provider.chat({
        ...params,
        onUsage: combineUsageListeners(
          params.onUsage,
          (usage) => {
            callbackReported = true;
            observerSafely(observer, {
              operation: "chat",
              requestContext: params.requestContext,
              usage,
            });
          },
        ),
      });
      if (response.usage && !callbackReported) {
        observerSafely(observer, {
          operation: "chat",
          requestContext: params.requestContext,
          usage: response.usage,
        });
      }
      return response;
    },
  };
}

function combineUsageListeners(
  first: TokenUsageListener | undefined,
  second: TokenUsageListener,
): TokenUsageListener {
  return (usage) => {
    callSafely(first, usage);
    callSafely(second, usage);
  };
}

function callSafely(
  listener: TokenUsageListener | undefined,
  usage: TokenUsage,
): void {
  if (!listener) return;
  try {
    listener(usage);
  } catch {
    // Observability cannot turn a successful Provider request into a failure.
  }
}

function observerSafely(
  observer: (observation: ProviderUsageObservation) => void,
  observation: ProviderUsageObservation,
): void {
  try {
    observer(observation);
  } catch {
    // Observability cannot turn a successful Provider request into a failure.
  }
}
