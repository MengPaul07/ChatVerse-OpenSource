export interface DebugConfig {
  enabled?: boolean;
  tracePrompts?: boolean;
  traceResponses?: boolean;
  traceToolCalls?: boolean;
  traceTiming?: boolean;
  maxEvents?: number;
}
