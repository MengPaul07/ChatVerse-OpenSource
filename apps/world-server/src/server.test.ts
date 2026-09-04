import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import type { ChatProvider, ProviderModelProfile, WebResearchProvider, WorldArchive } from "@chatverse/core";
import { compileWorldDraft, type WorldDraft } from "@chatverse/world-authoring";
import { compileWorldSourceBundle } from "@chatverse/world-source";
import { createWorldServer, listenHttpServer } from "./server.js";
import { WorldRoomRegistry } from "./rooms/registry.js";

const servers: Server[] = [];

const characterProvider: ChatProvider = {
  async complete({ requestContext }) {
    if (requestContext?.purpose === "world_narrator") {
      return JSON.stringify({
        narration: "晨雾沿着五行山的石壁缓缓退去。",
        sceneNow: "晨雾中的五行山下，来者正靠近封印。",
        wakes: [],
        playerTurn: null,
        directorRequest: null,
        beatStatus: "continue",
        outcome: null,
      });
    }
    return JSON.stringify({ type: "silent", reason: "server test" });
  },
  async *stream() {
    // Not used.
  },
  async chat() {
    return { content: "", toolCalls: [] };
  },
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

describe("world server", () => {
  it("imports a library character into an empty Studio without an opening or player", async () => {
    let calls = 0;
    const provider: ChatProvider = {
      ...characterProvider,
      async complete() { calls += 1; throw new Error("Import must not call a model"); },
      async chat() { calls += 1; throw new Error("Import must not call a model"); },
    };
    const app = createWorldServer({ providerFactory: () => ({
      directorProvider: provider, characterProvider: provider, authoringProvider: provider,
    }) });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const created = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions`, {
      method: "POST", body: "{}",
    });
    const session = created.body.session as { id: string; acceptedDraft: WorldDraft };
    const context = session.acceptedDraft.contexts[0]!;
    const operations = [
      { type: "upsert_actor", actor: {
        id: "import:library-card", role: "support", background: "",
        card: { name: "图书管理员", description: "", personality: "", scenario: "", messageExample: "",
          visual: { appearance: "圆框眼镜", portraitAssetId: "portrait-local" } },
      } },
      { type: "upsert_context", context: { ...context, actorIds: ["import:library-card"], opening: "" } },
    ];
    const edited = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions/${session.id}/operations`, {
      method: "POST", body: JSON.stringify({ baseRevision: 0, operations }),
    });
    expect(edited.response.status).toBe(200);
    const next = (edited.body.session as { acceptedDraft: WorldDraft }).acceptedDraft;
    expect(next.player).toBeUndefined();
    expect(next.contexts[0]!.opening).toBe("");
    expect(next.actors[0]!.card.visual?.portraitAssetId).toBe("portrait-local");
    expect(next.contexts[0]!.actorIds).toContain(next.actors[0]!.id);
    expect(calls).toBe(0);
    for (const opening of [null, 42, "a".repeat(20_001)]) {
      const invalid = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions/${session.id}/operations`, {
        method: "POST", body: JSON.stringify({ baseRevision: next.revision, operations: [
          { type: "upsert_context", context: { ...next.contexts[0], opening } },
        ] }),
      });
      expect(invalid.response.status).toBe(400);
    }
  });

  it("returns a clear configuration error for unsafe image provider URLs", async () => {
    const app = createWorldServer();
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const result = await jsonRequest(`${baseUrl}/api/v1/image-provider/test`, {
      method: "POST",
      body: "{}",
      headers: {
        "X-ChatVerse-Image-API-Key": "secret",
        "X-ChatVerse-Image-API-Base-URL": "https://127.0.0.1/v1",
        "X-ChatVerse-Image-Model": "test-model",
        "X-ChatVerse-Image-Protocol": "openai",
      },
    });

    expect(result.response.status).toBe(400);
    expect(result.body.code).toBe("invalid_image_provider_config");
    expect(result.body.message).toMatch(/内网/);
  });

  it("rejects a port conflict through the listen promise instead of an unhandled event", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    servers.push(occupied);
    const address = occupied.address() as AddressInfo;
    const candidate = createWorldServer();

    await expect(
      listenHttpServer(candidate.server, address.port, "127.0.0.1"),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("creates an isolated world, projects narration, and replays SSE events", async () => {
    let directorCalls = 0;
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(() => {
          directorCalls += 1;
        }),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const created = await createTestWorld(baseUrl);
    expect(created.response.status).toBe(201);
    const roomId = requiredString(created.body.roomId);
    const createdView = created.body.view as unknown as import("./types.js").WorldView;
    expect(createdView.world.status).toBe("idle");
    const stageMode = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/presentation/mode`,
      {
        method: "POST",
        body: JSON.stringify({ contextId: "five-elements-mountain", mode: "stage" }),
      },
    );
    expect(stageMode.response.status).toBe(200);
    expect((stageMode.body.view as unknown as import("./types.js").WorldView).contexts[0]).toMatchObject({
      pacingMultiplier: 1,
      presentationMode: "stage",
    });
    const presentationSettings = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/presentation/settings`,
      {
        method: "POST",
        body: JSON.stringify({
          contextId: "five-elements-mountain",
          presentationPrefetchLimit: 8,
        }),
      },
    );
    expect(presentationSettings.response.status).toBe(200);
    expect((presentationSettings.body.view as unknown as import("./types.js").WorldView).contexts[0]).toMatchObject({
      presentationPrefetchLimit: 8,
    });
    const worldMode = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/presentation/mode`,
      {
        method: "POST",
        body: JSON.stringify({ contextId: "five-elements-mountain", mode: "world" }),
      },
    );
    expect(worldMode.response.status).toBe(200);
    expect((worldMode.body.view as unknown as import("./types.js").WorldView).contexts[0]).toMatchObject({
      presentationMode: "world",
    });
    expect((worldMode.body.view as unknown as import("./types.js").WorldView).contexts[0]?.pacingMultiplier).toBeGreaterThan(0);
    const initialEntryCount = createdView.entries.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(directorCalls).toBe(0);
    const prematureProgression = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/progression`,
      {
        method: "POST",
        body: JSON.stringify({ contextId: "five-elements-mountain" }),
      },
    );
    expect(prematureProgression.response.status).toBe(409);
    expect(prematureProgression.body.code).toBe("world_not_running");

    const started = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/start`,
      { method: "POST" },
    );
    expect(started.response.status).toBe(200);
    expect((started.body.view as unknown as import("./types.js").WorldView).world.status)
      .toBe("running");
    const view = await waitForView(
      baseUrl,
      roomId,
      (candidate) => candidate.entries.length > initialEntryCount,
      4_000,
    );

    expect(directorCalls).toBeGreaterThan(0);
    expect(view.entries.at(-1)?.kind).toBe("narration");
    expect(view.narrative.beats).toHaveLength(1);
    expect(view.narrative.beats[0]?.sequence).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(view)).not.toContain("actorMemories");
    expect(JSON.stringify(view)).not.toContain("worldBook");
    const defaultDebug = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/debug`,
    );
    expect(defaultDebug.response.status).toBe(200);

    const abort = new AbortController();
    const response = await fetch(
      `${baseUrl}/api/v1/worlds/${roomId}/stream?after=0`,
      { signal: abort.signal },
    );
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    abort.abort();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("world_event");
    expect(text).toContain("world.progression.requested");
  });

  it("projects foreground recovery and exposes retry and dismiss through SSE-aware APIs", async () => {
    const hangingDirectorProvider: ChatProvider = {
      ...characterProvider,
      async chat() {
        return new Promise(() => undefined);
      },
    };
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: hangingDirectorProvider,
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const seed = await app.registry.createDefinitionRoom(
      compileWorldDraft(testWorldDraft()),
      false,
    );
    const archive = seed.archive();
    archive.snapshot.foregroundRecovery = [failedForegroundRecovery("failure:retry")];
    const retryRoom = await app.registry.createArchiveRoom(archive);

    expect(retryRoom.view().contexts[0]?.recovery).toMatchObject({
      contextId: "five-elements-mountain",
      status: "failed",
      failure: {
        id: "failure:retry",
        retryable: true,
      },
    });

    const wrongFailure = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${retryRoom.id}/recovery/retry`,
      {
        method: "POST",
        body: JSON.stringify({
          contextId: "five-elements-mountain",
          failureId: "failure:stale",
        }),
      },
    );
    expect(wrongFailure.response.status).toBe(409);
    expect(wrongFailure.body.code).toBe("recovery_stale");

    const unknownContext = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${retryRoom.id}/recovery/retry`,
      {
        method: "POST",
        body: JSON.stringify({
          contextId: "missing-context",
          failureId: "failure:retry",
        }),
      },
    );
    expect(unknownContext.response.status).toBe(404);
    expect(unknownContext.body.code).toBe("context_not_found");

    retryRoom.start();
    const retried = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${retryRoom.id}/recovery/retry`,
      {
        method: "POST",
        body: JSON.stringify({
          contextId: "five-elements-mountain",
          failureId: "failure:retry",
        }),
      },
    );
    expect(retried.response.status).toBe(202);
    const retriedRecovery = (retried.body.view as unknown as import("./types.js").WorldView)
      .contexts[0]?.recovery;
    expect(retriedRecovery).toMatchObject({
      id: "recovery:test",
      status: "retry_scheduled",
    });
    expect(retriedRecovery).not.toHaveProperty("failure");

    const streamController = new AbortController();
    const streamResponse = await fetch(
      `${baseUrl}/api/v1/worlds/${retryRoom.id}/stream?after=0`,
      { signal: streamController.signal },
    );
    const retryStream = await readSseUntil(streamResponse, "runtime.retry_scheduled");
    streamController.abort();
    expect(retryStream).toContain("world_notification");
    expect(retryStream).toContain("runtime.retry_scheduled");

    const dismissArchive = seed.archive();
    dismissArchive.snapshot.foregroundRecovery = [failedForegroundRecovery("failure:dismiss")];
    const dismissRoom = await app.registry.createArchiveRoom(dismissArchive);
    const dismissed = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${dismissRoom.id}/recovery/dismiss`,
      {
        method: "POST",
        body: JSON.stringify({
          contextId: "five-elements-mountain",
          failureId: "failure:dismiss",
        }),
      },
    );
    expect(dismissed.response.status).toBe(200);
    expect((dismissed.body.view as unknown as import("./types.js").WorldView).contexts[0]?.recovery)
      .toBeUndefined();

    const dismissedAgain = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${dismissRoom.id}/recovery/dismiss`,
      {
        method: "POST",
        body: JSON.stringify({
          contextId: "five-elements-mountain",
          failureId: "failure:dismiss",
        }),
      },
    );
    expect(dismissedAgain.response.status).toBe(404);
    expect(dismissedAgain.body.code).toBe("recovery_not_found");
  });

  it("accepts bound Source bundles alongside world_draft and world_archive", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const bundle = testSourceBundle();
    const binding = {
      bundleId: bundle.id,
      revision: bundle.revision,
      fidelity: "reference" as const,
    };
    const draft: WorldDraft = {
      ...testWorldDraft(),
      sources: [binding],
    };

    const created = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "world_draft", draft, bundles: [bundle] },
      }),
    });
    expect(created.response.status).toBe(201);
    expect((created.body.archive as { definition: { sources?: unknown[] } }).definition.sources)
      .toEqual([binding]);

    const archive = created.body.archive as unknown as import("@chatverse/core").WorldArchive;
    const restored = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "world_archive", archive, bundles: [bundle] },
      }),
    });
    expect(restored.response.status).toBe(201);
  });

  it("rejects source-bound drafts and archives when their bundles are missing", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const bundle = testSourceBundle();
    const draft: WorldDraft = {
      ...testWorldDraft(),
      sources: [{
        bundleId: bundle.id,
        revision: bundle.revision,
        fidelity: "reference",
      }],
    };

    const missingDraftBundle = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({ source: { kind: "world_draft", draft } }),
    });
    expect(missingDraftBundle.response.status).toBe(400);
    expect(missingDraftBundle.body.code).toBe("world_sources_missing");

    const valid = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "world_draft", draft, bundles: [bundle] },
      }),
    });
    expect(valid.response.status).toBe(201);
    const archive = valid.body.archive as unknown as import("@chatverse/core").WorldArchive;
    const missingArchiveBundle = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({ source: { kind: "world_archive", archive } }),
    });
    expect(missingArchiveBundle.response.status).toBe(400);
    expect(missingArchiveBundle.body.code).toBe("world_sources_missing");
  });

  it("rejects structurally invalid Source bundles", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const bundle = testSourceBundle();
    const draft: WorldDraft = {
      ...testWorldDraft(),
      sources: [{
        bundleId: bundle.id,
        revision: bundle.revision,
        fidelity: "reference",
      }],
    };

    const invalidBundle = {
      ...bundle,
      chunks: bundle.chunks.slice(1),
    };
    const invalid = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "world_draft", draft, bundles: [invalidBundle] },
      }),
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.code).toBe("invalid_world_sources");
  });

  it("keeps two browser rooms independent", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const first = await createTestWorld(baseUrl);
    const second = await createTestWorld(baseUrl);
    const firstId = requiredString(first.body.roomId);
    const secondId = requiredString(second.body.roomId);

    await startRoom(baseUrl, firstId);
    await jsonRequest(`${baseUrl}/api/v1/worlds/${firstId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        contextId: "five-elements-mountain",
        actorId: "player",
        message: "只属于第一个房间",
      }),
    });
    const firstView = await waitForView(
      baseUrl,
      firstId,
      (view) => view.entries.some((entry) => entry.text === "只属于第一个房间"),
    );
    const secondView = await getView(baseUrl, secondId);

    expect(firstView.entries.some((entry) => entry.text === "只属于第一个房间")).toBe(true);
    expect(secondView.entries.some((entry) => entry.text === "只属于第一个房间")).toBe(false);
  });

  it("creates a private context from an existing World Actor", async () => {
    const privateReplyProvider: ChatProvider = {
      ...characterProvider,
      async complete({ requestContext }) {
        if (requestContext?.purpose === "actor_decision") {
          return JSON.stringify({
            type: "perform",
            items: [{ kind: "message", message: "俺老孙听着呢，你说。" }],
          });
        }
        return JSON.stringify({ type: "silent", reason: "server test" });
      },
    };
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider: privateReplyProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const created = await createTestWorld(baseUrl);
    const roomId = requiredString(created.body.roomId);
    const opened = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/contexts`,
      {
        method: "POST",
        body: JSON.stringify({
          conversationMode: "private",
          actorIds: ["sun-wukong"],
        }),
      },
    );

    expect(opened.response.status).toBe(201);
    expect(opened.body.contextId).toBe("private:player:sun-wukong");
    expect((opened.body.view as unknown as import("./types.js").WorldView).contexts)
      .toContainEqual(expect.objectContaining({
        id: "private:player:sun-wukong",
        conversationMode: "private",
        actorIds: ["player", "sun-wukong"],
      }));

    const sent = await jsonRequest(`${baseUrl}/api/v1/worlds/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        contextId: "private:player:sun-wukong",
        actorId: "player",
        message: "悟空，你听得见吗？",
      }),
    });
    expect(sent.response.status).toBe(202);
    const replied = await waitForView(
      baseUrl,
      roomId,
      (view) => view.entries.some((entry) => (
        entry.contextId === "private:player:sun-wukong" &&
        entry.text === "俺老孙听着呢，你说。"
      )),
      7_000,
    );
    expect(replied.entries.some((entry) => (
      entry.contextId === "private:player:sun-wukong" &&
      entry.actorId === "sun-wukong"
    ))).toBe(true);
  });

  it("creates a group context with shared World Actors", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const created = await createTestWorld(baseUrl);
    const roomId = requiredString(created.body.roomId);
    const opened = await jsonRequest(`${baseUrl}/api/v1/worlds/${roomId}/contexts`, {
      method: "POST",
      body: JSON.stringify({
        conversationMode: "group",
        actorIds: ["sun-wukong", "tang-sanzang"],
        name: "山下碰头",
        topic: "商量下一步怎么走",
      }),
    });

    expect(opened.response.status).toBe(201);
    expect(opened.body.contextId).toMatch(/^group:/);
    expect((opened.body.view as unknown as import("./types.js").WorldView).contexts)
      .toContainEqual(expect.objectContaining({
        conversationMode: "group",
        name: "山下碰头",
        actorIds: ["player", "sun-wukong", "tang-sanzang"],
        status: "dormant",
        actorRuntime: expect.objectContaining({ activation: "autonomous_idle" }),
      }));

    const contextId = requiredString(opened.body.contextId);
    const resumed = await jsonRequest(`${baseUrl}/api/v1/worlds/${roomId}/context-resume`, {
      method: "POST",
      body: JSON.stringify({ contextId }),
    });
    expect(resumed.response.status).toBe(200);
    const resumedView = resumed.body.view as unknown as import("./types.js").WorldView;
    expect(resumedView.world.status).toBe("idle");
    expect(resumedView.contexts.find((context) => context.id === contextId)?.status).toBe("active");
  });

  it("exports a portable archive and restores it into a fresh idle room", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const created = await createTestWorld(baseUrl);
    const originalRoomId = requiredString(created.body.roomId);
    await startRoom(baseUrl, originalRoomId);
    await waitForView(
      baseUrl,
      originalRoomId,
      (view) => view.entries.some((entry) => entry.kind === "narration"),
    );
    await jsonRequest(`${baseUrl}/api/v1/worlds/${originalRoomId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        contextId: "five-elements-mountain",
        actorId: "player",
        message: "这句话必须跟随存档恢复。",
      }),
    });
    const settled = await waitForView(
      baseUrl,
      originalRoomId,
      (view) => view.entries.some((entry) => entry.text === "这句话必须跟随存档恢复。"),
    );

    const exported = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${originalRoomId}/archive`,
    );
    expect(exported.response.status).toBe(200);
    const archive = exported.body.archive as unknown as import("@chatverse/core").WorldArchive;
    expect(archive.schemaVersion).toBe(1);
    expect(archive.snapshot.schemaVersion).toBe(7);
    // The world may commit another actor/narration event between the view read
    // above and this independent archive request. The archive must therefore
    // be at least as current as the observed view and self-consistent.
    expect(archive.snapshot.eventSequence).toBeGreaterThanOrEqual(settled.world.eventSequence);
    expect(archive.metadata.eventSequence).toBe(archive.snapshot.eventSequence);
    expect(JSON.stringify(archive)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(archive)).not.toContain("debugSnapshot");

    const restored = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          kind: "world_archive",
          archive,
        },
      }),
    });
    expect(restored.response.status).toBe(201);
    const restoredRoomId = requiredString(restored.body.roomId);
    const restoredView = restored.body.view as unknown as import("./types.js").WorldView;
    expect(restoredRoomId).not.toBe(originalRoomId);
    expect(restoredView.world.archiveId).toBe(archive.archiveId);
    expect(restoredView.world.status).toBe("idle");
    expect(restoredView.world.eventSequence).toBe(archive.snapshot.eventSequence);
    expect(restoredView.entries.some((entry) => (
      entry.text === "这句话必须跟随存档恢复。"
    ))).toBe(true);

    await startRoom(baseUrl, restoredRoomId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const resumed = await getView(baseUrl, restoredRoomId);
    expect(resumed.world.eventSequence).toBeGreaterThanOrEqual(archive.snapshot.eventSequence);
    expect(resumed.entries.some((entry) => (
      entry.text === "这句话必须跟随存档恢复。"
    ))).toBe(true);

    await jsonRequest(`${baseUrl}/api/v1/worlds/${restoredRoomId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        contextId: "five-elements-mountain",
        actorId: "player",
        message: "恢复之后继续发生。",
      }),
    });
    const continued = await waitForView(
      baseUrl,
      restoredRoomId,
      (view) => view.entries.some((entry) => entry.text === "恢复之后继续发生。"),
    );
    expect(continued.world.eventSequence).toBeGreaterThan(archive.snapshot.eventSequence);

    const unsupported = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          kind: "world_archive",
          archive: { ...archive, schemaVersion: 99 },
        },
      }),
    });
    expect(unsupported.response.status).toBe(400);
    expect(unsupported.body.code).toBe("unsupported_archive_version");

    const mismatched = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          kind: "world_archive",
          archive: {
            ...archive,
            worldId: "another-world",
          },
        },
      }),
    });
    expect(mismatched.response.status).toBe(400);
    expect(mismatched.body.code).toBe("archive_world_mismatch");

    const incomplete = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          kind: "world_archive",
          archive: {
            ...archive,
            snapshot: {
              ...archive.snapshot,
              dynamicActors: undefined,
            },
          },
        },
      }),
    });
    expect(incomplete.response.status).toBe(400);
    expect(incomplete.body.code).toBe("invalid_world_archive");
  });

  it("bootstraps the first beat when an unstarted template archive is restored", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const created = await createTestWorld(baseUrl);
    const archive = created.body.archive as unknown as import("@chatverse/core").WorldArchive;
    expect(archive.snapshot.narrative.chapters).toHaveLength(2);
    expect(archive.snapshot.narrative.beats).toHaveLength(0);

    const restored = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: { kind: "world_archive", archive },
      }),
    });
    expect(restored.response.status).toBe(201);
    const roomId = requiredString(restored.body.roomId);
    const beforeStart = restored.body.view as unknown as import("./types.js").WorldView;
    expect(beforeStart.narrative.chapters).toHaveLength(2);
    expect(beforeStart.narrative.beats).toHaveLength(0);

    await startRoom(baseUrl, roomId);
    const bootstrapped = await waitForView(
      baseUrl,
      roomId,
      (view) => view.narrative.chapters.length > 0 && view.narrative.beats.length > 0,
    );

    expect(bootstrapped.narrative.chapters[0]?.id).toBe("chapter-release-wukong");
    expect(bootstrapped.narrative.beats[0]?.chapterId).toBe("chapter-release-wukong");
  });

  it("exposes diagnostics only when enabled and replays them on a separate SSE channel", async () => {
    const persistedDebugEvents: unknown[] = [];
    const disabledApp = createWorldServer({
      debug: false,
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const disabledBaseUrl = await listen(disabledApp.server);
    servers.push(disabledApp.server);
    const disabledRoom = await createTestWorld(disabledBaseUrl);
    const disabledRoomId = requiredString(disabledRoom.body.roomId);
    const disabledDebug = await jsonRequest(
      `${disabledBaseUrl}/api/v1/worlds/${disabledRoomId}/debug`,
    );
    expect(disabledDebug.response.status).toBe(404);
    expect(disabledDebug.body.code).toBe("debug_disabled");

    const enabledApp = createWorldServer({
      debug: {
        enabled: true,
        tracePrompts: false,
        traceResponses: false,
      },
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
      registry: {
        debugEventSink: (entry) => persistedDebugEvents.push(entry),
      },
    });
    const enabledBaseUrl = await listen(enabledApp.server);
    servers.push(enabledApp.server);
    const enabledRoom = await createTestWorld(enabledBaseUrl);
    const enabledRoomId = requiredString(enabledRoom.body.roomId);
    await startRoom(enabledBaseUrl, enabledRoomId);
    await waitForView(
      enabledBaseUrl,
      enabledRoomId,
      (view) => view.entries.some((entry) => entry.kind === "narration"),
    );
    await jsonRequest(`${enabledBaseUrl}/api/v1/worlds/${enabledRoomId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        contextId: "five-elements-mountain",
        actorId: "player",
        message: "debug probe",
      }),
    });
    await waitForView(
      enabledBaseUrl,
      enabledRoomId,
      (view) => view.entries.some((entry) => entry.text === "debug probe"),
    );

    const debug = await jsonRequest(
      `${enabledBaseUrl}/api/v1/worlds/${enabledRoomId}/debug`,
    );
    expect(debug.response.status).toBe(200);
    const debugJson = JSON.stringify(debug.body);
    expect(debugJson).toContain("director.response");
    expect(debugJson).toContain("context.message.committed");
    expect(debugJson).not.toContain("You are the World Director");
    expect(persistedDebugEvents.length).toBeGreaterThan(0);
    expect(persistedDebugEvents).toContainEqual(expect.objectContaining({
      roomId: enabledRoomId,
      event: expect.objectContaining({ type: "context.message.committed" }),
    }));

    const limitedDebug = await jsonRequest(
      `${enabledBaseUrl}/api/v1/worlds/${enabledRoomId}/debug?eventLimit=1`,
    );
    expect(limitedDebug.response.status).toBe(200);
    expect((limitedDebug.body as {
      debug: { snapshot: { events: unknown[] } };
    }).debug.snapshot.events).toHaveLength(1);

    const abort = new AbortController();
    const stream = await fetch(
      `${enabledBaseUrl}/api/v1/worlds/${enabledRoomId}/debug/stream?after=0`,
      { signal: abort.signal },
    );
    const streamText = await readSseUntil(stream, "debug_event");
    abort.abort();
    expect(streamText).toContain("event: debug_event");
    expect(streamText).toContain("\"kind\":\"debug_event\"");
  });

  it("manages Actor presence, participation, and Director authority through the World API", async () => {
    const app = createWorldServer({
      debug: true,
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const created = await createTestWorld(baseUrl);
    const roomId = requiredString(created.body.roomId);
    const actorBase = `${baseUrl}/api/v1/worlds/${roomId}/actors/sun-wukong`;

    const presence = await jsonRequest(`${actorBase}/presence`, {
      method: "POST",
      body: JSON.stringify({
        presence: "offline",
        status: "暂时离线",
      }),
    });
    expect(presence.response.status).toBe(200);
    expect((presence.body.actor as { presence?: string }).presence).toBe("offline");

    const participation = await jsonRequest(`${actorBase}/participation`, {
      method: "POST",
      body: JSON.stringify({
        contextId: "five-elements-mountain",
        participation: "muted",
      }),
    });
    expect(participation.response.status).toBe(200);
    expect(
      (participation.body.actor as {
        contexts?: Array<{ participation: string }>;
      }).contexts?.[0]?.participation,
    ).toBe("muted");

    const control = await jsonRequest(`${actorBase}/control`, {
      method: "POST",
      body: JSON.stringify({
        directorAuthority: "manage",
      }),
    });
    expect(control.response.status).toBe(200);
    expect(
      (control.body.actor as {
        control?: { directorAuthority?: string };
      }).control,
    ).toMatchObject({
      directorAuthority: "manage",
    });

    const invalid = await jsonRequest(`${actorBase}/presence`, {
      method: "POST",
      body: JSON.stringify({ presence: "sleeping" }),
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.code).toBe("invalid_request");

  });

  it("registers and joins a runtime Actor through the public World API", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const created = await createTestWorld(baseUrl);
    const roomId = requiredString(created.body.roomId);

    const registered = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/actors`,
      {
        method: "POST",
        body: JSON.stringify({
          actor: {
            id: "zhu-bajie",
            kind: "character",
            card: {
              name: "猪八戒",
              description: "后来加入取经队伍的角色",
              personality: "直率",
              scenario: "",
              messageExample: "",
            },
          },
          relations: [{
            fromActorId: "zhu-bajie",
            toActorId: "sun-wukong",
            description: "尚未相识",
          }],
        }),
      },
    );
    expect(registered.response.status).toBe(201);
    const registeredView = registered.body.view as unknown as import("./types.js").WorldView;
    expect(registeredView.actors.find((actor) => actor.id === "zhu-bajie"))
      .toMatchObject({ name: "猪八戒", contexts: [] });

    const joined = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/actors/zhu-bajie/participation`,
      {
        method: "POST",
        body: JSON.stringify({
          contextId: "five-elements-mountain",
          participation: "joined",
          reason: "沿山路来到五行山下",
        }),
      },
    );
    expect(joined.response.status).toBe(200);
    const joinedView = joined.body.view as unknown as import("./types.js").WorldView;
    expect(joinedView.actors.find((actor) => actor.id === "zhu-bajie")?.contexts)
      .toContainEqual({
        contextId: "five-elements-mountain",
        participation: "joined",
      });

    const registeredAndJoined = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/actors`,
      {
        method: "POST",
        body: JSON.stringify({
          actor: {
            id: "sha-wujing",
            kind: "character",
            card: {
              name: "沙悟净",
              description: "沿流沙河而来的行者",
              personality: "沉静",
              scenario: "",
              messageExample: "",
            },
          },
          contextId: "five-elements-mountain",
          participation: "joined",
          reason: "从角色库带入当前世界",
        }),
      },
    );
    expect(registeredAndJoined.response.status).toBe(201);
    const combinedView = registeredAndJoined.body.view as unknown as import("./types.js").WorldView;
    expect(combinedView.actors.find((actor) => actor.id === "sha-wujing")?.contexts)
      .toContainEqual({
        contextId: "five-elements-mountain",
        participation: "joined",
      });

    const duplicate = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/actors`,
      {
        method: "POST",
        body: JSON.stringify({
          actor: {
            id: "zhu-bajie",
            kind: "character",
            card: {
              name: "重复角色",
              description: "重复注册测试",
              personality: "",
              scenario: "",
              messageExample: "",
            },
          },
        }),
      },
    );
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.code).toBe("actor_exists");
  });

  it("runs a GroupCard as a Director-free single-context World", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const created = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          kind: "group_card",
          group: {
            kind: "chatverse.group",
            schemaVersion: 1,
            metadata: { id: "friends", name: "朋友群" },
            characters: [{
              name: "小明",
              description: "群友",
              personality: "自然简短",
              scenario: "",
              messageExample: "",
            }],
            userProfiles: [{ name: "你", card: "群成员" }],
            scene: {
              groupName: "朋友群",
              topic: "日常聊天",
              atmosphere: "轻松",
            },
          },
        },
      }),
    });

    expect(created.response.status).toBe(201);
    const roomId = requiredString(created.body.roomId);
    const view = created.body.view as unknown as import("./types.js").WorldView;
    expect(view.runtime).toEqual({
      directorEnabled: false,
      actorMemoryEnabled: false,
      room: {
        viewerCount: 0,
        autoPauseEnabled: true,
        autoPauseAfterMs: 300_000,
        autoPauseDueAt: undefined,
        autoPausedAt: undefined,
      },
    });
    expect(view.contexts).toHaveLength(1);
    expect(view.contexts[0]?.conversationMode).toBe("group");
    expect(view.director.status).toBe("idle");
    expect(view.world.status).toBe("idle");

    const started = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/start`,
      { method: "POST" },
    );
    expect(started.response.status).toBe(200);
    expect((started.body.view as unknown as import("./types.js").WorldView).world.status)
      .toBe("running");

    const pausedContext = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/context-pause`,
      {
        method: "POST",
        body: JSON.stringify({ contextId: "friends:context:main" }),
      },
    );
    expect(pausedContext.response.status).toBe(200);
    expect((pausedContext.body.view as unknown as import("./types.js").WorldView).contexts[0])
      .toMatchObject({ status: "paused", pauseReason: "manual" });
    const resumedContext = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/context-resume`,
      {
        method: "POST",
        body: JSON.stringify({ contextId: "friends:context:main" }),
      },
    );
    expect(resumedContext.response.status).toBe(200);
    expect((resumedContext.body.view as unknown as import("./types.js").WorldView).contexts[0]?.status)
      .toBe("active");

    const pacing = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/pacing`,
      {
        method: "POST",
        body: JSON.stringify({ contextId: "friends:context:main", multiplier: 1.8 }),
      },
    );
    expect(pacing.response.status).toBe(200);
    expect((pacing.body.view as unknown as import("./types.js").WorldView).contexts[0]?.pacingMultiplier)
      .toBe(1.8);

    const disabledAutoPause = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/runtime-policy`,
      {
        method: "POST",
        body: JSON.stringify({ autoPauseEnabled: false }),
      },
    );
    expect(disabledAutoPause.response.status).toBe(200);
    expect((disabledAutoPause.body.view as unknown as import("./types.js").WorldView).runtime.room)
      .toMatchObject({ autoPauseEnabled: false, viewerCount: 0 });

    const enabledAutoPause = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/runtime-policy`,
      {
        method: "POST",
        body: JSON.stringify({ autoPauseEnabled: true, autoPauseAfterMinutes: 2 }),
      },
    );
    expect(enabledAutoPause.response.status).toBe(200);
    expect((enabledAutoPause.body.view as unknown as import("./types.js").WorldView).runtime.room)
      .toMatchObject({ autoPauseEnabled: true, autoPauseAfterMs: 120_000, viewerCount: 0 });
    expect((enabledAutoPause.body.view as unknown as import("./types.js").WorldView).runtime.room.autoPauseDueAt)
      .toBeTypeOf("number");

  });

  it("auto-pauses an unobserved Group after its first unread message", async () => {
    let characterCalls = 0;
    const unreadProvider: ChatProvider = {
      ...characterProvider,
      async complete() {
        characterCalls += 1;
        return JSON.stringify({
          type: "perform",
          items: [{ kind: "message", message: "收到。" }],
        });
      },
    };
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider: unreadProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const created = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          kind: "group_card",
          group: {
            kind: "chatverse.group",
            schemaVersion: 1,
            metadata: { id: "unread-group", name: "未读测试群" },
            characters: [{
              name: "小明",
              description: "群友",
              personality: "主动",
              scenario: "",
              messageExample: "",
            }],
            userProfiles: [{ name: "你", card: "测试成员" }],
            scene: { groupName: "未读测试群", topic: "测试", atmosphere: "安静" },
            runtime: {
              pacing: { multiplier: 0.25 },
              interaction: { interventionCommitWindowMs: 0 },
            },
          },
        },
      }),
    });
    const roomId = requiredString(created.body.roomId);
    await startRoom(baseUrl, roomId);
    const sent = await jsonRequest(`${baseUrl}/api/v1/worlds/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        contextId: "unread-group:context:main",
        actorId: "unread-group:player:1",
        message: "@小明 有人吗？",
      }),
    });
    expect(sent.response.status).toBe(202);

    const paused = await waitForView(
      baseUrl,
      roomId,
      (view) => view.contexts[0]?.status === "paused",
      3_000,
    );
    expect(paused.contexts[0]).toMatchObject({
      pauseReason: "unread",
      unreadCount: 1,
    });
    expect(characterCalls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(characterCalls).toBe(1);
  });

  it("creates, auto-applies, and advances a WorldDraft through authoring APIs", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
        authoringProvider: authoringProvider(),
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const created = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions`, {
      method: "POST",
      body: JSON.stringify({ runtimeProfile: "group_chat" }),
    });
    expect(created.response.status).toBe(201);
    const session = created.body.session as {
      id: string;
      acceptedDraft: { revision: number };
    };
    expect(session.acceptedDraft.revision).toBe(0);

    const edited = await jsonRequest(
      `${baseUrl}/api/v1/authoring/sessions/${session.id}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ message: "创建一个山门前的双人世界" }),
      },
    );
    expect(edited.response.status).toBe(200);
    const editedSession = edited.body.session as {
      acceptedDraft: { revision: number };
      workingDraft: { revision: number };
    };
    expect(editedSession.acceptedDraft.revision).toBeGreaterThan(0);
    expect(editedSession.workingDraft.revision).toBe(editedSession.acceptedDraft.revision);

    const settledSession = await waitForAuthoringSession(
      baseUrl,
      session.id,
      (value) => value.task?.status === "completed",
    );
    expect(settledSession.plan?.items.map((item) => item.status))
      .toEqual(["completed", "completed", "completed"]);
    expect(
      settledSession.validation.valid,
      JSON.stringify({
        issues: settledSession.validation.issues,
        actors: settledSession.acceptedDraft.actors,
      }),
    ).toBe(true);

    const logResponse = await jsonRequest(
      `${baseUrl}/api/v1/authoring/sessions/${session.id}/log?limit=1000`,
    );
    expect(logResponse.response.status).toBe(200);
    const harnessLog = logResponse.body.events as Array<{
      sequence: number;
      type: string;
      turnId: string;
      step?: number;
    }>;
    expect(harnessLog.map((event) => event.type)).toEqual(expect.arrayContaining([
      "turn.started",
      "step.started",
      "model.requested",
      "model.completed",
      "tool.called",
      "tool.completed",
      "draft.committed",
      "turn.completed",
    ]));
    expect(harnessLog.map((event) => event.sequence)).toEqual(
      harnessLog.map((_, index) => index + 1),
    );
    expect((logResponse.body.harness as { modelRequestCount: number }).modelRequestCount).toBeGreaterThan(1);

    const manualRevision = settledSession.acceptedDraft.revision;
    const manuallyRefined = await jsonRequest(
      `${baseUrl}/api/v1/authoring/sessions/${session.id}/operations`,
      {
        method: "POST",
        body: JSON.stringify({
          baseRevision: manualRevision,
          summary: "在自动创作后手动补充语气",
          operations: [{ type: "set_metadata", metadata: { tone: "克制、潮湿" } }],
        }),
      },
    );
    expect(manuallyRefined.response.status).toBe(200);
    const acceptedSession = manuallyRefined.body.session as typeof editedSession & {
      acceptedDraft: Record<string, unknown>;
      validation: { valid: boolean };
    };
    expect((acceptedSession.acceptedDraft as unknown as { metadata: { tone?: string } }).metadata.tone)
      .toBe("克制、潮湿");
    expect(acceptedSession.validation.valid).toBe(true);

    const started = await jsonRequest(`${baseUrl}/api/v1/worlds`, {
      method: "POST",
      body: JSON.stringify({
        source: {
          kind: "world_draft",
        draft: acceptedSession.acceptedDraft,
        },
      }),
    });
    expect(started.response.status).toBe(201);
    const view = started.body.view as unknown as import("./types.js").WorldView;
    expect(view.world.name).toBe("山门旧事");
    expect(view.runtime.directorEnabled).toBe(false);
    expect(view.world.status).toBe("idle");
    expect((started.body.archive as { worldId: string }).worldId).toBe(view.world.id);
    expect((started.body.archive as { snapshot: { eventSequence: number } }).snapshot.eventSequence)
      .toBe(view.world.eventSequence);

    const roomId = requiredString(started.body.roomId);
    const running = await jsonRequest(
      `${baseUrl}/api/v1/worlds/${roomId}/start`,
      { method: "POST" },
    );
    expect(running.response.status).toBe(200);
    expect((running.body.view as unknown as import("./types.js").WorldView).world.status)
      .toBe("running");
  });

  it("keeps authoring sessions isolated", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
        authoringProvider: authoringProvider(),
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const first = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions`, {
      method: "POST",
      body: "{}",
    });
    const second = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions`, {
      method: "POST",
      body: "{}",
    });
    const firstSession = first.body.session as { id: string };
    const secondSession = second.body.session as { id: string };
    expect(firstSession.id).not.toBe(secondSession.id);

    const secondView = await jsonRequest(
      `${baseUrl}/api/v1/authoring/sessions/${secondSession.id}`,
    );
    expect((secondView.body.session as { acceptedDraft: { revision: number } }).acceptedDraft.revision)
      .toBe(0);
  });

  it("applies direct World Studio edits through the revision and undo path", async () => {
    const app = createWorldServer({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
        authoringProvider: authoringProvider(),
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const created = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const session = created.body.session as { id: string };
    const edited = await jsonRequest(
      `${baseUrl}/api/v1/authoring/sessions/${session.id}/operations`,
      {
        method: "POST",
        body: JSON.stringify({
          baseRevision: 0,
          summary: "改名",
          operations: [{
            type: "set_metadata",
            metadata: { name: "手动编辑的世界", description: "一份新简介" },
          }],
        }),
      },
    );
    expect(edited.response.status).toBe(200);
    expect((edited.body.session as { acceptedDraft: { revision: number; metadata: { name: string } } })
      .acceptedDraft).toMatchObject({ revision: 1, metadata: { name: "手动编辑的世界" } });

    const stale = await jsonRequest(
      `${baseUrl}/api/v1/authoring/sessions/${session.id}/operations`,
      {
        method: "POST",
        body: JSON.stringify({
          baseRevision: 0,
          operations: [{ type: "set_premise", premise: "旧版本不应覆盖" }],
        }),
      },
    );
    expect(stale.response.status).toBe(409);
    expect(stale.body.code).toBe("authoring_conflict");

    const undone = await jsonRequest(
      `${baseUrl}/api/v1/authoring/sessions/${session.id}/undo`,
      { method: "POST" },
    );
    expect(undone.response.status).toBe(200);
    expect((undone.body.session as { acceptedDraft: { revision: number; metadata: { name: string } } })
      .acceptedDraft).toMatchObject({ revision: 2, metadata: { name: "未命名世界" } });
  });

  it("returns useful provider and unknown-room errors", async () => {
    const app = createWorldServer({ apiKeyConfigured: false });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const missingProvider = await createTestWorld(baseUrl);
    expect(missingProvider.response.status).toBe(503);
    expect(missingProvider.body.code).toBe("provider_not_configured");

    const invalidProviderConfig = await createTestWorld(baseUrl, {
      headers: { "X-ChatVerse-API-Base-URL": "file:///etc/passwd" },
    });
    expect(invalidProviderConfig.response.status).toBe(400);
    expect(invalidProviderConfig.body.code).toBe("invalid_provider_config");

    const invalidProtocol = await createTestWorld(baseUrl, {
      headers: {
        "X-ChatVerse-API-Key": "client-key",
        "X-ChatVerse-Protocol": "unsupported-protocol",
      },
    });
    expect(invalidProtocol.response.status).toBe(400);
    expect(invalidProtocol.body.code).toBe("invalid_provider_config");

    const credentialInOptions = await createTestWorld(baseUrl, {
      headers: {
        "X-ChatVerse-API-Key": "client-key",
        "X-ChatVerse-Provider-Options": JSON.stringify({ openai: { apiKey: "should-not-be-here" } }),
      },
    });
    expect(credentialInOptions.response.status).toBe(400);
    expect(credentialInOptions.body.code).toBe("invalid_provider_config");

    let receivedConfig: {
      apiKey?: string;
      baseURL?: string;
      model?: string;
      protocol?: string;
      providerName?: string;
      providerOptions?: Record<string, unknown>;
    } | undefined;
    const byokApp = createWorldServer({
      apiKeyConfigured: false,
      providerFactory: (config) => {
        receivedConfig = config;
        return {
          directorProvider: narrationProvider(),
          characterProvider,
        };
      },
    });
    const byokBaseUrl = await listen(byokApp.server);
    servers.push(byokApp.server);
    const byok = await createTestWorld(byokBaseUrl, {
      headers: {
        "X-ChatVerse-API-Key": "client-supplied-key",
        "X-ChatVerse-API-Base-URL": "https://api.example.test/v1",
        "X-ChatVerse-Model": "example-chat",
        "X-ChatVerse-Protocol": "anthropic-messages",
        "X-ChatVerse-Provider": "chatverse-utf8:%E6%99%BA%E8%B0%B1%20AI",
        "X-ChatVerse-Provider-Options": "chatverse-utf8:%7B%22anthropic%22%3A%7B%22extendedThinking%22%3Atrue%7D%7D",
      },
    });
    expect(byok.response.status).toBe(201);
    expect(receivedConfig).toMatchObject({
      apiKey: "client-supplied-key",
      baseURL: "https://api.example.test/v1",
      model: "example-chat",
      protocol: "anthropic-messages",
      providerName: "智谱 AI",
      providerOptions: { anthropic: { extendedThinking: true } },
    });

    const missingRoom = await jsonRequest(`${baseUrl}/api/v1/worlds/missing`);
    expect(missingRoom.response.status).toBe(404);
    expect(missingRoom.body.code).toBe("room_not_found");
  });

  it("refreshes an existing room when a later request supplies new provider settings", async () => {
    const receivedConfigs: Array<{ apiKey?: string; baseURL?: string; model?: string } | undefined> = [];
    const app = createWorldServer({
      apiKeyConfigured: false,
      providerFactory: (config) => {
        receivedConfigs.push(config);
        return {
          directorProvider: characterProvider,
          characterProvider,
        };
      },
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const created = await createTestWorld(baseUrl, {
      headers: {
        "X-ChatVerse-API-Key": "first-key",
        "X-ChatVerse-API-Base-URL": "https://first.example.test/v1",
        "X-ChatVerse-Model": "first-model",
      },
    });
    const roomId = requiredString(created.body.roomId);
    expect(receivedConfigs).toHaveLength(1);

    const refreshed = await jsonRequest(`${baseUrl}/api/v1/worlds/${roomId}`, {
      headers: {
        "X-ChatVerse-API-Key": "second-key",
        "X-ChatVerse-API-Base-URL": "https://second.example.test/v1",
        "X-ChatVerse-Model": "second-model",
      },
    });

    expect(refreshed.response.status).toBe(200);
    expect(receivedConfigs).toHaveLength(2);
    expect(receivedConfigs[1]).toMatchObject({
      apiKey: "second-key",
      baseURL: "https://second.example.test/v1",
      model: "second-model",
    });
  });

  it("tests a request-scoped provider before a client can save its settings", async () => {
    const requestProfile: ProviderModelProfile = {
      id: "example-chat",
      reasoning: false,
      input: ["text"],
      compatibility: { supportsFullJsonSchema: false },
    };
    let receivedConfig: {
      apiKey?: string;
      baseURL?: string;
      model?: string;
      modelProfile?: ProviderModelProfile;
    } | undefined;
    let chatCalls = 0;
    const app = createWorldServer({
      apiKeyConfigured: false,
      providerFactory: (config) => {
        receivedConfig = config;
        return {
          directorProvider: {
            ...characterProvider,
            profile: {
              protocol: "openai-chat",
              providerName: "Test Gateway",
              model: "example-chat",
              capabilities: {
                stream: true,
                tools: true,
                json: "prompt",
                reasoning: "none",
                webSearch: false,
                vision: false,
                toolChoice: "auto",
              },
              modelProfile: requestProfile,
              compatibility: requestProfile.compatibility ?? {},
            },
            async chat({ messages }) {
              chatCalls += 1;
              expect(messages.at(-1)?.content).toBe("Reply with OK only.");
              return { content: "OK", toolCalls: [] };
            },
          },
          characterProvider,
        };
      },
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const tested = await jsonRequest(`${baseUrl}/api/v1/provider/test`, {
      method: "POST",
      headers: {
        "X-ChatVerse-API-Key": "client-secret",
        "X-ChatVerse-API-Base-URL": "https://api.example.test/v1",
        "X-ChatVerse-Model": "example-chat",
        "X-ChatVerse-Model-Profile": `chatverse-utf8:${encodeURIComponent(JSON.stringify({
          id: "example-chat",
          reasoning: false,
          input: ["text"],
          compatibility: { supportsFullJsonSchema: false },
        }))}`,
      },
      body: "{}",
    });

    expect(tested.response.status).toBe(200);
    expect(tested.body).toMatchObject({
      ok: true,
      model: "example-chat",
      provider: "Test Gateway",
      providerName: "Test Gateway",
      protocol: "openai-chat",
      modelProfile: requestProfile,
    });
    expect(receivedConfig).toEqual({
      apiKey: "client-secret",
      baseURL: "https://api.example.test/v1",
      model: "example-chat",
      modelProfile: requestProfile,
    });
    expect(chatCalls).toBe(1);
  });

  it("tests and enables a request-scoped research provider without exposing credentials", async () => {
    let receivedResearchModel: string | undefined;
    const researchProvider: WebResearchProvider = {
      profile: {
        protocol: "responses-web-search",
        providerName: "Research Test",
        baseURL: "https://research.example.test/v1",
        model: "research-model",
      },
      async search() {
        return {
          summary: "公开资料摘要",
          sources: [{
            title: "公开来源",
            url: "https://example.com/source",
            accessedAt: 1,
            note: "测试用途",
          }],
        };
      },
    };
    const app = createWorldServer({
      apiKeyConfigured: false,
      providerFactory: (config) => {
        receivedResearchModel = config?.research?.model;
        return {
          directorProvider: characterProvider,
          characterProvider,
          researchProvider,
        };
      },
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);
    const headers = {
      "X-ChatVerse-API-Key": "client-secret",
      "X-ChatVerse-API-Base-URL": "https://api.example.test/v1",
      "X-ChatVerse-Model": "example-chat",
      "X-ChatVerse-Research-Protocol": "responses-web-search",
      "X-ChatVerse-Research-Provider": "Research Test",
      "X-ChatVerse-Research-API-Key": "research-secret",
      "X-ChatVerse-Research-API-Base-URL": "https://research.example.test/v1",
      "X-ChatVerse-Research-Model": "research-model",
    };

    const tested = await jsonRequest(`${baseUrl}/api/v1/provider/research-test`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(tested.response.status).toBe(200);
    expect(tested.body).toMatchObject({ ok: true, sourceCount: 1, model: "research-model" });
    expect(JSON.stringify(tested.body)).not.toContain("client-secret");
    expect(receivedResearchModel).toBe("research-model");

    const created = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const sessionId = requiredString((created.body.session as { id?: unknown }).id);
    expect((created.body.session as { research: { available: boolean } }).research.available).toBe(true);
    const enabled = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions/${sessionId}/research`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.response.status).toBe(200);
    expect((enabled.body.session as { research: { enabled: boolean } }).research.enabled).toBe(true);
  });

  it("redacts upstream errors from the provider connection test", async () => {
    const app = createWorldServer({
      apiKeyConfigured: false,
      providerFactory: () => ({
        directorProvider: {
          ...characterProvider,
          async chat() {
            throw new Error("upstream failure containing client-secret");
          },
        },
        characterProvider,
      }),
    });
    const baseUrl = await listen(app.server);
    servers.push(app.server);

    const tested = await jsonRequest(`${baseUrl}/api/v1/provider/test`, {
      method: "POST",
      headers: { "X-ChatVerse-API-Key": "client-secret" },
      body: "{}",
    });

    expect(tested.response.status).toBe(502);
    expect(tested.body.code).toBe("provider_connection_failed");
    expect(tested.body.message).not.toContain("client-secret");
  });
});

describe("WorldRoomRegistry", () => {
  it("auto-pauses a running room after its last viewer leaves", async () => {
    const registry = new WorldRoomRegistry({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
    });
    const room = await registry.createDefinitionRoom(compileWorldDraft(testWorldDraft()));
    room.start();
    room.configureRuntime({ autoPauseAfterMs: 5 });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(room.view().world.status).toBe("paused");
    expect(room.runtimeState()).toMatchObject({
      viewerCount: 0,
      autoPauseEnabled: true,
      autoPauseAfterMs: 5,
    });
    expect(room.runtimeState().autoPausedAt).toBeTypeOf("number");
    registry.stopAll();
  });

  it("evicts the oldest inactive room at capacity", async () => {
    let now = 1_000;
    const registry = new WorldRoomRegistry({
      providerFactory: () => ({
        directorProvider: narrationProvider(),
        characterProvider,
      }),
      maxRooms: 1,
      now: () => now,
    });
    const first = await registry.createDefinitionRoom(compileWorldDraft(testWorldDraft()));
    now += 1;
    const second = await registry.createDefinitionRoom(compileWorldDraft(testWorldDraft()));

    expect(registry.get(first.id)).toBeUndefined();
    expect(registry.get(second.id)).toBe(second);
    registry.stopAll();
  });
});

function narrationProvider(onChat?: () => void): ChatProvider {
  return {
    ...characterProvider,
    async chat({ messages }) {
      onChat?.();
      const hasBeatRequest = messages
        .filter((message) => message.role === "user")
        .some((message) => (
          message.content.includes("world.progression.requested")
          || message.content.includes("mode: plan_beat")
          || message.content.includes("mode: transition_beat")
          || message.content.includes("修复下面的 Beat JSON")
        ));
      if (!hasBeatRequest) {
        return {
          content: "",
          toolCalls: [{
            id: "finish",
            type: "function",
            function: { name: "finish", arguments: "{}" },
          }],
        };
      }
      return {
        content: "",
        toolCalls: [
          {
            id: "beat",
            type: "function",
            function: {
              name: "plan_beat",
              arguments: JSON.stringify({
                title: "五行山晨雾",
                brief: "晨雾退去，取经人靠近五行山下的封印。",
                script: {
                  time: "清晨",
                  location: "五行山封印前",
                  cast: [
                    { actorRef: "A1", roleInScene: "说明被困缘由并确认取经人身份" },
                    { actorRef: "A2", roleInScene: "确认封印与同行条件" },
                  ],
                  cause: "取经人抵达五行山下的封印。",
                  development: ["马蹄声抵近封印。", "双方隔着山石确认来意。", "封印关系被清楚指出。"],
                  turningPoint: "被困者明确说出自己等待取经人的缘由。",
                  result: "双方已经确认彼此身份并开始直接交涉。",
                  causalChain: ["取经人到来引发呼喊。", "对话确认双方身份。", "身份确认开启揭帖交涉。"],
                },
                minimumActorTurns: 4,
                maximumActorTurns: 8,
                contextRefs: ["C1"],
                actorRefs: ["A1", "A2"],
              }),
            },
          },
        ],
      };
    },
  };
}

function authoringProvider(): ChatProvider {
  return {
    ...characterProvider,
    async chat({ messages }) {
      const lastToolName = [...messages]
        .reverse()
        .find((message) => message.role === "assistant" && message.tool_calls?.length)
        ?.tool_calls?.[0]?.function.name;
      const hasWrittenPlan = messages.some((message) => (
        message.role === "assistant" && message.tool_calls?.some(
          (toolCall) => toolCall.function.name === "write_authoring_plan",
        )
      ));
      if (lastToolName && [
        "update_world_core",
        "save_player_card",
        "save_actor",
        "save_relations",
        "save_context",
                "save_chapter",
        "remove_draft_entities",
        "set_runtime_profile",
      ].includes(lastToolName)) {
        return {
          content: "### 当前阶段完成\n\n修改已直接写入草稿。",
          toolCalls: [{
            id: "finish-authoring",
            type: "function",
            function: {
              name: "finish",
              arguments: JSON.stringify({
                summary: "建立山门世界、角色关系与开场章节。",
              }),
            },
          }],
        };
      }
      const prompt = [...messages].reverse().find((message) => (
        message.role === "user" && message.content.includes("[草稿索引]")
      ))?.content ?? "";
      const index = JSON.parse(
        prompt.match(/\[草稿索引\]\n(.+)\n\n\[创作计划\]/s)?.[1] ?? "{}",
      ) as {
        revision?: number;
        player?: { id: string };
        actors?: Array<{ id: string }>;
        contexts?: Array<{ id: string }>;
      };
      const serializedPlan = prompt.match(
        /\[创作计划\]\n(.+)\n\n\[可用能力\]/s,
      )?.[1]?.trim();
      const suppliedPlan = serializedPlan && !serializedPlan.startsWith("(")
        ? JSON.parse(serializedPlan) as {
            items?: Array<{ scope: string; status: string }>;
          }
        : undefined;
      if (!suppliedPlan && !hasWrittenPlan && lastToolName !== "write_authoring_plan") {
        return {
          content: "## 创作计划\n\n我会先搭好世界核心，再制作角色卡，最后完成开场场景。",
          toolCalls: [{
            id: "plan-authoring",
            type: "function",
            function: {
              name: "write_authoring_plan",
              arguments: JSON.stringify({
                goal: "创建一个山门前的双人世界",
                items: [
                  { title: "确定世界核心", scope: "foundation" },
                  { title: "制作守门人角色卡", scope: "actors" },
                  { title: "布置雨夜山门开场", scope: "context" },
                ],
              }),
            },
          }],
        };
      }
      const activeScope = lastToolName === "write_authoring_plan"
        ? "foundation"
        : suppliedPlan?.items?.find((item) => item.status === "in_progress")?.scope;
      const contextId = index.contexts?.[0]?.id ?? "context:main";
      const actorId = index.actors?.[0]?.id ?? "keeper";
      const draftTool = activeScope === "actors"
        ? {
            name: "save_actor",
            arguments: {
              actor: {
              id: actorId,
              role: "lead",
              card: {
                name: "守门人",
                description: "守着旧山门的人",
                personality: "警惕，言语简短",
                scenario: "只知道山门和旧约的部分真相",
                messageExample: "回去吧。今晚不该有人来。",
              },
            },
            },
          }
        : activeScope === "context"
          ? {
              name: "save_context",
              arguments: {
                context: {
                id: contextId,
                name: "旧山门",
                actorIds: [actorId],
                scene: {
                  groupName: "山门旧事",
                  topic: "陌生来客",
                  atmosphere: "雨声压住远处的钟",
                  state: "flowing",
                },
                opening: "雨水沿着紧闭的山门流下，门内亮起一盏灯。",
              },
              },
            }
          : {
              name: "update_world_core",
              arguments: {
                metadata: {
                  name: "山门旧事",
                  description: "守门人与来客在雨夜相遇。",
                },
                premise: "雨夜，一位陌生来客抵达封闭多年的山门。",
                lore: { core: "山门封闭多年，门后藏着旧约。" },
              },
            };
      return {
        content: `### 正在执行\n\n${activeScope === "actors" ? "制作角色卡" : activeScope === "context" ? "布置开场场景" : "确定世界核心"}。`,
        toolCalls: [{
          id: "apply-authoring",
          type: "function",
          function: {
            name: draftTool.name,
            arguments: JSON.stringify(draftTool.arguments),
          },
        }],
      };
    },
  };
}

function testWorldDraft(): WorldDraft {
  return {
    schemaVersion: 1,
    id: "server-test-world",
    revision: 0,
    metadata: {
      name: "五行山测试世界",
      description: "用于验证 World Server 正式创建路径的测试世界。",
    },
    premise: "取经人来到五行山下，被困的猴王等待一次改变命运的相遇。",
    lore: {
      core: "五行山压着孙悟空，唐三藏正沿山路西行。",
      rules: ["角色只依据已经观察到的事实行动。"],
    },
    player: {
      id: "player",
      mode: "participant",
      profile: { name: "你", card: "来到五行山下的旅人。" },
      playerCard: {
        name: "旅人",
        identity: "误入五行山的旅人",
        background: "你在山路附近醒来，只能依据亲眼看见和听见的事情行动。",
        personality: "谨慎、好奇，先确认再行动。",
        appearance: "穿着沾尘的旅行衣，随身没有武器或法器。",
        speechStyle: "用自然直接的语气说话，区分事实与猜测。",
        boundaries: "不拥有法力、天庭身份、取经安排或未来知识。",
      },
    },
    actors: [
      {
        id: "sun-wukong",
        role: "lead",
        card: {
          name: "孙悟空",
          description: "被压在五行山下的齐天大圣。",
          personality: "机敏、骄傲、爽利。",
          scenario: "听见取经人的马蹄声逐渐接近。",
          messageExample: "那和尚，可敢替俺揭下山顶的帖子？",
        },
        background: "等待脱困，也在判断来者是否值得信任。",
      },
      {
        id: "tang-sanzang",
        role: "lead",
        card: {
          name: "唐三藏",
          description: "奉命西行取经的僧人。",
          personality: "温和谨慎，重视因果与承诺。",
          scenario: "初到五行山，只听见山下有人呼喊。",
          messageExample: "施主为何被困在此？",
        },
        background: "尚不清楚山下之人的身份与来历。",
      },
      {
        id: "guanyin",
        role: "support",
        card: {
          name: "观音",
          description: "引导取经因缘的菩萨。",
          personality: "平静克制，只作必要引导。",
          scenario: "关注取经因缘是否顺利展开。",
          messageExample: "路在眼前，选择仍在本心。",
        },
        background: "知晓大势，但不会替众人决定。",
      },
    ],
    relations: [],
    contexts: [{
      id: "five-elements-mountain",
      name: "五行山下",
      actorIds: ["sun-wukong", "tang-sanzang", "guanyin", "player"],
      scene: {
        groupName: "五行山下",
        topic: "揭帖之前的相遇",
        atmosphere: "暮色与山风交织。",
        state: "flowing",
      },
      opening: "暮色落在五行山下，远处传来渐近的马蹄声。",
    }],
    chapters: [{
      id: "chapter-release-wukong",
      title: "揭帖与同行",
      treatment: "唐三藏抵达五行山下后，需要在揭帖、收徒与继续西行之间逐步确认孙悟空的性情和承诺。沿途由山下试探、戒律交代、同行磨合等多场戏展开，具体过程留给运行时处理。",
      targetOutcome: "唐三藏正式确认孙悟空为同行弟子，并以明确戒律和承诺开启西行。",
      status: "active",
      actorIds: ["sun-wukong", "tang-sanzang", "guanyin"],
      contextIds: ["five-elements-mountain"],
    }, {
      id: "chapter-release-wukong:follow-up",
      title: "山路初行",
      treatment: "收徒之后，新的同行关系必须在真实山路上经受第一轮磨合。唐三藏要把戒律变成可执行的行路规则，孙悟空要面对被约束与保护师父之间的冲突，观音留下的使命和沿途出现的危险则不断检验他们是否真的形成了队伍。章节通过多场赶路、争执、救援和现场判断逐步改变彼此的责任边界，不预写固定对白，也不把任何一次冲突直接当成最终答案。后续剧情可以让玩家追问旧因、介入行路安排或促成一次风险选择，但每次推进都必须留下新的行动条件。",
      targetOutcome: "师徒在第一次共同危机后确立一套可执行的同行规则，并带着明确分工继续上路。",
      status: "queued",
      actorIds: ["sun-wukong", "tang-sanzang"],
      contextIds: ["five-elements-mountain"],
    }],
    runtimeProfile: "world_story",
  };
}

function failedForegroundRecovery(
  failureId: string,
): NonNullable<WorldArchive["snapshot"]["foregroundRecovery"]>[number] {
  return {
    id: "recovery:test",
    contextId: "five-elements-mountain",
    operation: "director",
    responsibility: "open_beat",
    status: "failed",
    attempt: 1,
    maxAutomaticRetries: 1,
    expectedAt: 1_000,
    lastProgressAt: 2_000,
    failure: {
      id: failureId,
      kind: "task_incomplete",
      message: "Director did not plan the requested Beat.",
      userMessage: "剧情推进未能完成。",
      retryable: true,
      occurredAt: 2_000,
    },
  };
}

function testSourceBundle() {
  return compileWorldSourceBundle({
    id: "server-source",
    revision: 4,
    name: "五行山旧档",
    description: "World Server Source 入口测试资料。",
    documents: [{
      path: "lore/five-elements-mountain.md",
      content: "# 五行山旧档\n\n## 山顶法帖\n\n山顶法帖维持封印，只有取经人抵达后才可能改变局面。",
    }],
  });
}

async function createTestWorld(baseUrl: string, init: RequestInit = {}) {
  return jsonRequest(`${baseUrl}/api/v1/worlds`, {
    ...init,
    method: "POST",
    body: JSON.stringify({
      source: { kind: "world_draft", draft: testWorldDraft() },
    }),
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function startRoom(baseUrl: string, roomId: string): Promise<void> {
  const started = await jsonRequest(
    `${baseUrl}/api/v1/worlds/${roomId}/start`,
    { method: "POST" },
  );
  expect(started.response.status).toBe(200);
}

async function jsonRequest(url: string, init?: RequestInit): Promise<{
  response: Response;
  body: Record<string, unknown>;
}> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  return {
    response,
    body: await response.json() as Record<string, unknown>,
  };
}

async function getView(baseUrl: string, roomId: string): Promise<import("./types.js").WorldView> {
  const result = await jsonRequest(`${baseUrl}/api/v1/worlds/${roomId}`);
  if (!result.body.view) throw new Error("Missing WorldView");
  return result.body.view as unknown as import("./types.js").WorldView;
}

async function waitForAuthoringSession(
  baseUrl: string,
  sessionId: string,
  predicate: (session: {
    task?: { status: string };
    plan?: { items: Array<{ status: string }> };
    acceptedDraft: { revision: number; metadata?: { tone?: string }; actors?: unknown[] };
    validation: { valid: boolean; issues?: unknown[] };
  }) => boolean,
  timeoutMs = 2_000,
): Promise<{
  task?: { status: string };
  plan?: { items: Array<{ status: string }> };
  acceptedDraft: { revision: number; metadata?: { tone?: string }; actors?: unknown[] };
  validation: { valid: boolean; issues?: unknown[] };
}> {
  const startedAt = Date.now();
  while (true) {
    const result = await jsonRequest(`${baseUrl}/api/v1/authoring/sessions/${sessionId}`);
    const session = result.body.session as {
      task?: { status: string };
      plan?: { items: Array<{ status: string }> };
      acceptedDraft: { revision: number; metadata?: { tone?: string }; actors?: unknown[] };
      validation: { valid: boolean; issues?: unknown[] };
    };
    if (predicate(session)) return session;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for AuthoringSession");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForView(
  baseUrl: string,
  roomId: string,
  predicate: (view: import("./types.js").WorldView) => boolean,
  timeoutMs = 1_500,
): Promise<import("./types.js").WorldView> {
  const startedAt = Date.now();
  while (true) {
    const view = await getView(baseUrl, roomId);
    if (predicate(view)) return view;
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for WorldView");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value;
}

async function readSseUntil(
  response: Response,
  marker: string,
  timeoutMs = 1_000,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE response body");
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let value = "";
  while (!value.includes(marker)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for SSE marker: ${marker}`);
    }
    const chunk = await reader.read();
    if (chunk.done) break;
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value;
}
