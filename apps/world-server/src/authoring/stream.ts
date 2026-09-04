import type { ServerResponse } from "node:http";

export type AuthoringStreamKind =
  | "authoring.status"
  | "authoring.agent_prompt"
  | "authoring.agent_response"
  | "authoring.agent_tool"
  | "authoring.agent_tool_start"
  | "authoring.agent_step_end"
  | "authoring.agent_delta"
  | "authoring.plan_changed"
  | "authoring.task_changed"
  | "authoring.agent_result"
  | "authoring.session_event"
  | "authoring.research_started"
  | "authoring.research_completed"
  | "authoring.research_failed"
  | "authoring.research_mode_changed"
  | "authoring.source_artifact_created"
  | "authoring.source_artifact_consumed"
  | "authoring.draft_changed"
  | "authoring.preview_completed"
  | "authoring.error"
  | "resync_required";

export interface AuthoringStreamPayload {
  sequence: number;
  kind: AuthoringStreamKind;
  data?: Record<string, unknown>;
}

interface AuthoringSseClient {
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

const SSE_HEARTBEAT_MS = 15_000;

export class AuthoringStreamChannel {
  private readonly clients = new Set<AuthoringSseClient>();
  private readonly streamCache: AuthoringStreamPayload[] = [];
  private sequence = 0;

  constructor(
    private readonly streamCacheSize: number,
    private readonly now: () => number,
  ) {}

  get clientCount(): number {
    return this.clients.size;
  }

  get lastSequence(): number {
    return this.sequence;
  }

  attach(response: ServerResponse, afterSequence: number): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 2000\n\n");
    const firstCachedSequence = this.streamCache[0]?.sequence;
    if (
      afterSequence > 0 &&
      firstCachedSequence != null &&
      afterSequence < firstCachedSequence - 1
    ) {
      writeAuthoringSse(response, {
        sequence: this.sequence,
        kind: "resync_required",
      });
    } else {
      for (const payload of this.streamCache) {
        if (payload.sequence > afterSequence) writeAuthoringSse(response, payload);
      }
    }
    const client: AuthoringSseClient = {
      response,
      heartbeat: setInterval(() => {
        try {
          response.write(`: authoring-heartbeat ${this.now()}\n\n`);
        } catch {
          this.remove(client);
        }
      }, SSE_HEARTBEAT_MS),
    };
    client.heartbeat.unref();
    this.clients.add(client);
    response.on("close", () => this.remove(client));
    response.on("error", () => this.remove(client));
  }

  publish(kind: AuthoringStreamKind, data?: Record<string, unknown>): void {
    const payload: AuthoringStreamPayload = {
      sequence: ++this.sequence,
      kind,
      data,
    };
    this.streamCache.push(payload);
    if (this.streamCache.length > this.streamCacheSize) {
      this.streamCache.splice(0, this.streamCache.length - this.streamCacheSize);
    }
    for (const client of [...this.clients]) {
      try {
        writeAuthoringSse(client.response, payload);
      } catch {
        this.remove(client);
      }
    }
  }

  close(): void {
    for (const client of [...this.clients]) {
      client.response.end();
      this.remove(client);
    }
  }

  private remove(client: AuthoringSseClient): void {
    if (!this.clients.delete(client)) return;
    clearInterval(client.heartbeat);
  }
}

function writeAuthoringSse(response: ServerResponse, payload: AuthoringStreamPayload): void {
  response.write(`id: ${payload.sequence}\n`);
  response.write(`event: ${payload.kind}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
