import type {
  ChatProvider,
  ChatResponse,
  LLMMessage,
  ProviderProfile,
  ProviderRequestContext,
  ToolDefinition,
} from "../contracts/provider.js";

export type ProviderSessionOperation = "complete" | "stream" | "chat";

export type ProviderSessionEvent =
  | {
      type: "request";
      requestId: string;
      operation: ProviderSessionOperation;
      requestContext?: ProviderRequestContext;
      profile?: ProviderProfile;
      input: Record<string, unknown>;
    }
  | {
      type: "response";
      requestId: string;
      operation: ProviderSessionOperation;
      requestContext?: ProviderRequestContext;
      elapsedMs: number;
      output: unknown;
    }
  | {
      type: "error";
      requestId: string;
      operation: ProviderSessionOperation;
      requestContext?: ProviderRequestContext;
      elapsedMs: number;
      error: { name: string; message: string; stack?: string };
    };

let nextProviderRequestId = 0;

/** Captures complete provider exchanges for local debug session logs. */
export function observeProviderSession(
  provider: ChatProvider,
  observer: (event: ProviderSessionEvent) => void,
  now: () => number = Date.now,
): ChatProvider {
  return {
    get profile() {
      return provider.profile;
    },

    async complete(params) {
      const request = begin("complete", params.requestContext, {
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        maxTokens: params.maxTokens,
        responseFormat: params.responseFormat,
        thinking: params.thinking,
      }, provider.profile, observer, now);
      try {
        const output = await provider.complete(params);
        finish(request, output, observer, now);
        return output;
      } catch (error) {
        fail(request, error, observer, now);
        throw error;
      }
    },

    async *stream(params) {
      const request = begin("stream", params.requestContext, {
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
      }, provider.profile, observer, now);
      let output = "";
      try {
        for await (const delta of provider.stream(params)) {
          output += delta;
          yield delta;
        }
        finish(request, output, observer, now);
      } catch (error) {
        fail(request, error, observer, now);
        throw error;
      }
    },

    async chat(params) {
      const request = begin("chat", params.requestContext, {
        messages: cloneMessages(params.messages),
        tools: cloneTools(params.tools),
        toolChoice: params.toolChoice,
        thinking: params.thinking,
        reasoningEffort: params.reasoningEffort,
        maxTokens: params.maxTokens,
        stream: params.stream,
      }, provider.profile, observer, now);
      try {
        const output = await provider.chat(params);
        finish(request, cloneChatResponse(output), observer, now);
        return output;
      } catch (error) {
        fail(request, error, observer, now);
        throw error;
      }
    },
  };
}

interface PendingRequest {
  requestId: string;
  operation: ProviderSessionOperation;
  requestContext?: ProviderRequestContext;
  startedAt: number;
}

function begin(
  operation: ProviderSessionOperation,
  requestContext: ProviderRequestContext | undefined,
  input: Record<string, unknown>,
  profile: ProviderProfile | undefined,
  observer: (event: ProviderSessionEvent) => void,
  now: () => number,
): PendingRequest {
  const requestId = `provider-${++nextProviderRequestId}`;
  const request = { requestId, operation, requestContext, startedAt: now() };
  notify(observer, {
    type: "request",
    requestId,
    operation,
    requestContext,
    profile: publicProfile(profile),
    input,
  });
  return request;
}

function finish(
  request: PendingRequest,
  output: unknown,
  observer: (event: ProviderSessionEvent) => void,
  now: () => number,
): void {
  notify(observer, {
    type: "response",
    requestId: request.requestId,
    operation: request.operation,
    requestContext: request.requestContext,
    elapsedMs: Math.max(0, now() - request.startedAt),
    output,
  });
}

function fail(
  request: PendingRequest,
  value: unknown,
  observer: (event: ProviderSessionEvent) => void,
  now: () => number,
): void {
  const error = value instanceof Error ? value : new Error(String(value));
  notify(observer, {
    type: "error",
    requestId: request.requestId,
    operation: request.operation,
    requestContext: request.requestContext,
    elapsedMs: Math.max(0, now() - request.startedAt),
    error: { name: error.name, message: error.message, stack: error.stack },
  });
}

function notify(observer: (event: ProviderSessionEvent) => void, event: ProviderSessionEvent): void {
  try {
    observer(structuredClone(event));
  } catch {
    // Debug logging cannot affect provider execution.
  }
}

function cloneMessages(messages: readonly LLMMessage[]): LLMMessage[] {
  return structuredClone([...messages]);
}

function cloneTools(tools: readonly ToolDefinition[] | undefined): ToolDefinition[] | undefined {
  return tools ? structuredClone([...tools]) : undefined;
}

function cloneChatResponse(response: ChatResponse): ChatResponse {
  return structuredClone(response);
}

function publicProfile(profile: ProviderProfile | undefined): ProviderProfile | undefined {
  if (!profile) return undefined;
  const { providerOptions: _providerOptions, ...value } = profile;
  return structuredClone(value);
}
