import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RadioTower } from "lucide-react";
import type { WorldDebugEvent } from "@chatverse/core";

interface ProviderExchange {
  id: string;
  request?: WorldDebugEvent;
  result?: WorldDebugEvent;
}

export function ProviderSessionLog({ events }: { events: readonly WorldDebugEvent[] }) {
  const exchanges = buildExchanges(events);
  if (exchanges.length === 0) {
    return (
      <div className="provider-session-empty">
        <RadioTower size={24} />
        <strong>还没有 Provider 请求</strong>
        <span>模型请求发生后，这里会完整记录输入与输出。</span>
      </div>
    );
  }
  return (
    <div className="provider-session-log">
      {[...exchanges].reverse().map((exchange) => (
        <ProviderExchangeCard key={exchange.id} exchange={exchange} />
      ))}
    </div>
  );
}

function ProviderExchangeCard({ exchange }: { exchange: ProviderExchange }) {
  const [requestOpen, setRequestOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const requestPayload = exchange.request?.payload;
  const resultPayload = exchange.result?.payload;
  const context = objectValue(requestPayload?.requestContext ?? resultPayload?.requestContext);
  const operation = stringValue(requestPayload?.operation ?? resultPayload?.operation) ?? "request";
  const purpose = stringValue(context?.purpose) ?? "other";
  const elapsedMs = numberValue(resultPayload?.elapsedMs);
  const failed = exchange.result?.type === "provider.session_error";
  return (
    <article className={`provider-exchange ${failed ? "is-error" : ""}`}>
      <header>
        <span className="provider-exchange-status">
          {failed ? <AlertTriangle size={15} /> : exchange.result ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
        </span>
        <strong>{purpose}</strong>
        <code>{operation}</code>
        {stringValue(context?.characterName) && <span>{stringValue(context?.characterName)}</span>}
        {stringValue(context?.actorId) && <span>{stringValue(context?.actorId)}</span>}
        <small>{elapsedMs == null ? "进行中" : `${elapsedMs} ms`}</small>
        <time>{formatTime(exchange.request?.occurredAt ?? exchange.result?.occurredAt)}</time>
      </header>
      <details open={requestOpen} onToggle={(event) => setRequestOpen(event.currentTarget.open)}>
        <summary>Request</summary>
        {requestOpen && <pre>{pretty(requestPayload?.input ?? { missing: true })}</pre>}
      </details>
      <details open={resultOpen} onToggle={(event) => setResultOpen(event.currentTarget.open)}>
        <summary>{failed ? "Error" : "Response"}</summary>
        {resultOpen && <pre>{pretty(failed ? resultPayload?.error : resultPayload?.output ?? { pending: true })}</pre>}
      </details>
    </article>
  );
}

function buildExchanges(events: readonly WorldDebugEvent[]): ProviderExchange[] {
  const values = new Map<string, ProviderExchange>();
  for (const event of events) {
    if (!event.type.startsWith("provider.session_")) continue;
    const id = event.correlationId ?? stringValue(event.payload.requestId) ?? event.id;
    const exchange = values.get(id) ?? { id };
    if (event.type === "provider.session_request") exchange.request = event;
    else exchange.result = event;
    values.set(id, exchange);
  }
  return [...values.values()].sort((left, right) => (
    (left.request?.sequence ?? left.result?.sequence ?? 0) -
    (right.request?.sequence ?? right.result?.sequence ?? 0)
  ));
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function formatTime(value: number | undefined): string {
  return value == null ? "" : new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
