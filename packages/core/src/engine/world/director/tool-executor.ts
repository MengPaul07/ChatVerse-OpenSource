import type { ToolCall } from "../../../contracts/provider.js";
import type {
  ActorPresence,
  ContextParticipation,
  NarrativeBeatSceneActor,
  NarrativeBeatScript,
  NarrativeEdgeType,
} from "../../../contracts/world.js";
import type { WorldDirectorHost } from "./types.js";
import type { WorldDirectorMutation } from "./tools.js";
import type { DirectorReferenceTable } from "./references.js";

export interface ToolExecutionResult {
  output: string;
  accepted: boolean;
  finished?: boolean;
}

/** Values owned by the Host and injected outside the model-visible JSON. */
export interface DirectorToolBindings {
  chapterId?: string;
  sourceEventIds?: readonly string[];
  sourceBundleId?: string;
  sourceChunkIds?: readonly string[];
  sourceBindingRevision?: number;
}

/**
 * Providers occasionally append a second JSON fragment or a markdown fence to
 * an otherwise complete function argument. Keep the first object so the
 * follow-up tool message remains valid for providers that validate the
 * assistant tool-call envelope before accepting the next turn.
 */
export function normalizeDirectorToolCall(call: ToolCall): ToolCall {
  let argumentsValue = "{}";
  try {
    argumentsValue = JSON.stringify(parseToolArguments(call.function.arguments));
  } catch {
    // The tool executor will return the actionable parse error. The sanitized
    // envelope prevents the provider from rejecting the whole continuation.
  }
  return {
    ...call,
    function: {
      ...call.function,
      arguments: argumentsValue,
    },
  };
}

export function executeDirectorTool(
  call: ToolCall,
  mutations: WorldDirectorMutation[],
  host: WorldDirectorHost,
  references: DirectorReferenceTable,
  readSourceChunkIds: Set<string>,
  sourceChunkIdsReadBeforeRound: ReadonlySet<string>,
  roundHasSourceLookup: boolean,
  strictSourceRequired: boolean,
  bindings?: DirectorToolBindings,
): ToolExecutionResult {
  try {
    const args = parseArgs(call);
    switch (call.function.name) {
      case "inspect_context": {
        const contextRef = requiredString(args.contextRef, "contextRef");
        const contextId = resolveReference(references, "context", contextRef);
        if (!contextId || !host.validateContextId(contextId)) return unknownReference("Context", contextRef, references, "context");
        return success(references.redactKnownIds(host.inspectContext(contextId, clampNumber(args.limit, 10, 1, 20))));
      }
      case "query_narrative": {
        const query = optionalString(args.query) ?? "";
        const chapterRef = optionalString(args.chapterRef);
        const beatRef = optionalString(args.beatRef);
        const chapterId = chapterRef
          ? resolveReference(references, "chapter", chapterRef)
          : undefined;
        const beatId = beatRef
          ? resolveReference(references, "beat", beatRef)
          : undefined;
        if (chapterRef && (!chapterId || !host.validateChapterId(chapterId, mutations))) {
          return unknownReference("Chapter", chapterRef, references, "chapter");
        }
        if (beatRef && (!beatId || !host.validateBeatId(beatId, mutations))) {
          return unknownReference("Beat", beatRef, references, "beat");
        }
        const limit = clampNumber(args.limit, 10, 1, 20);
        return success(references.redactKnownIds(host.queryNarrative(query, chapterId, beatId, limit)));
      }
      case "query_actors": {
        const actorRef = optionalString(args.actorRef);
        if (actorRef) {
          const actorId = resolveReference(references, "actor", actorRef);
          if (!actorId || !host.validateActorId(actorId)) return unknownReference("Actor", actorRef, references, "actor");
          return success(references.redactKnownIds(host.inspectActor(actorId)));
        }
        const contextRef = optionalString(args.contextRef);
        const contextId = contextRef
          ? resolveReference(references, "context", contextRef)
          : undefined;
        if (contextRef && (!contextId || !host.validateContextId(contextId))) {
          return unknownReference("Context", contextRef, references, "context");
        }
        return success(references.redactKnownIds(host.searchActors(
          optionalString(args.query) ?? "",
          contextId,
          clampNumber(args.limit, 8, 1, 20),
        )));
      }
      case "retrieve_source": {
        const sourceRef = requiredString(args.sourceRef, "sourceRef");
        const bundleId = resolveReference(references, "source", sourceRef);
        if (!bundleId || !host.validateSourceBundleId(bundleId)) return unknownReference("Source", sourceRef, references, "source");
        const result = host.retrieveSource(
          bundleId,
          requiredString(args.query, "query"),
          clampNumber(args.limit, 6, 1, 8),
        );
        for (const chunkId of result.chunkIds) {
          readSourceChunkIds.add(sourceChunkKey(bundleId, chunkId));
        }
        references.registerSourceChunks(bundleId, result.chunkIds);
        return success(references.redactKnownIds(result.content));
      }
      case "update_actor_background": {
        const actorRef = requiredString(args.actorRef, "actorRef");
        const actorId = resolveReference(references, "actor", actorRef);
        if (!actorId || !host.validateActorId(actorId)) return unknownReference("Actor", actorRef, references, "actor");
        if (mutations.some((mutation) => (
          mutation.type === "update_actor_background" &&
          mutation.actorId === actorId
        ))) {
          return failure(`Actor background already staged in this pass: ${actorId}`);
        }
        const text = requiredString(args.text, "text");
        if ([...text].length > 600) {
          return failure("Actor background must not exceed 600 characters.");
        }
        const sourceEventIds = resolveEventIds(
          args.eventRefs,
          host.validateEventId,
          references,
        );
        if (sourceEventIds.length === 0) return failure("eventRefs cannot be empty and every item must be a valid E* reference.");
        const validationError = host.validateActorBackgroundUpdate(
          actorId,
          text,
          sourceEventIds,
        );
        if (validationError) return failure(validationError);
        mutations.push({
          type: "update_actor_background",
          actorId,
          text,
          sourceEventIds,
        });
        return success("Actor background update staged.");
      }
      case "emit_world_event": {
        const contextIds = resolveReferenceList(args.contextRefs, references, "context", host.validateContextId, "Context");
        const actorIds = resolveReferenceList(args.actorRefs, references, "actor", host.validateActorId, "Actor");
        mutations.push({
          type: "emit_world_event",
          message: requiredString(args.message, "message"),
          contextIds,
          actorIds,
          correlationId: optionalString(args.correlationId),
        });
        return success("World event staged.");
      }
      case "plan_beat": {
        if (mutations.some((mutation) => mutation.type === "plan_beat")) {
          return failure("At most one Narrative Beat may be staged in one Director pass.");
        }
        const newChapter = parseNewChapter(args.newChapter);
        if (bindings?.chapterId && newChapter) {
          return failure("The Host already bound the current Chapter; do not provide newChapter.");
        }
        if (!bindings?.chapterId && !newChapter) {
          return failure("plan_beat requires a Host-bound Chapter or a newChapter definition.");
        }
        const chapterId = bindings?.chapterId
          ?? (newChapter ? host.nextId() : undefined);
        if (!chapterId) {
          return failure("No Chapter is available for this Beat.");
        }
        if (bindings?.chapterId && !host.validateChapterId(chapterId, mutations)) {
          return failure("The selected Chapter is no longer available in this run.");
        }
        const sourceEventIds = bindings?.sourceEventIds
          ? resolveTrustedIds(bindings.sourceEventIds, host.validateEventId)
          : resolveEventIds(args.eventRefs, host.validateEventId, references);
        if (sourceEventIds.length === 0) return failure("No valid committed Event references are available for this Beat.");
        const duplicateError = newChapter
          ? undefined
          : host.validateBeatSources(chapterId, sourceEventIds, mutations);
        if (duplicateError) return failure(duplicateError);
        const contextIds = resolveReferenceList(args.contextRefs, references, "context", host.validateContextId, "Context");
        if (contextIds.length === 0) return failure("contextRefs cannot be empty.");
        const sceneActorResult = parseSceneActors(
          args.script,
          host,
          sourceEventIds,
          references,
        );
        if (sceneActorResult.actors.some((actor) => !contextIds.includes(actor.contextId))) {
          return failure("Every script.sceneActors contextRef must be included in contextRefs.");
        }
        const actorRefs = strictStringArray(args.actorRefs, "actorRefs");
        if (actorRefs.length === 0) return failure("actorRefs cannot be empty.");
        const actorIds = [...new Set([
          ...resolveActorReferences(actorRefs, references, sceneActorResult.aliases, host.validateActorId),
          ...sceneActorResult.actors.map((actor) => actor.actorId),
        ])];
        const script = requiredBeatScript(
          args.script,
          actorIds,
          sceneActorResult.aliases,
          sceneActorResult.actors,
          actorRefs,
          references,
        );
        const sourceBundleId = bindings?.sourceBundleId;
        const sourceChunkIds = [...(bindings?.sourceChunkIds ?? [])];
        if (strictSourceRequired && (!sourceBundleId || !sourceChunkIds || sourceChunkIds.length === 0)) {
          return failure(
            "A Beat in a strict Source world must cite Source chunks read in an earlier round.",
          );
        }
        if (sourceChunkIds.length > 0 && !sourceBundleId) {
          return failure("sourceBundleId is required when sourceChunkIds is non-empty.");
        }
        if (roundHasSourceLookup && (
          !sourceBundleId ||
          sourceChunkIds.length === 0 ||
          sourceChunkIds.some((chunkId) => (
            !sourceChunkIdsReadBeforeRound.has(sourceChunkKey(sourceBundleId, chunkId))
          ))
        )) {
          return failure(
            "A plan_beat submitted alongside Source lookup must cite chunks read in an earlier round.",
          );
        }
        if (sourceBundleId && sourceChunkIds.some((chunkId) => (
          !sourceChunkIdsReadBeforeRound.has(sourceChunkKey(sourceBundleId, chunkId))
        ))) {
          return failure("Every sourceChunkId must be read from this bundle in an earlier Director round.");
        }
        if (sourceChunkIds.length > 0 && (
          !sourceBundleId || !host.validateSourceChunkIds(sourceBundleId, sourceChunkIds)
        )) {
          return failure("sourceChunkIds must belong to one bound Source bundle revision.");
        }
        const expectedRevision = sourceBundleId
          ? host.sourceBindingRevision(sourceBundleId)
          : undefined;
        const sourceBindingRevision = sourceChunkIds.length > 0
          ? bindings?.sourceBindingRevision ?? expectedRevision
          : undefined;
        if (sourceChunkIds.length > 0 && sourceBindingRevision !== expectedRevision) {
          return failure("sourceBindingRevision does not match the immutable bound revision.");
        }
        const sourceAdherence = optionalString(args.sourceAdherence);
        if (sourceAdherence && !["follow", "adapt", "diverge"].includes(sourceAdherence)) {
          return failure(`Invalid sourceAdherence: ${sourceAdherence}`);
        }
        const kind = optionalBeatKind(args.kind) ?? "full_scene";
        const title = requiredString(args.title, "title");
        const brief = requiredString(args.brief, "brief");
        const minimumActorTurns = clampNumber(
          args.minimumActorTurns,
          kind === "full_scene" ? 10 : kind === "transition" ? 4 : 3,
          1,
          24,
        );
        const maximumActorTurns = clampNumber(
          args.maximumActorTurns,
          kind === "full_scene" ? 20 : kind === "transition" ? 8 : 6,
          minimumActorTurns + 1,
          32,
        );
        const id = host.nextId();
        mutations.push({
          type: "plan_beat",
          id,
          chapterId,
          newChapter,
          title,
          brief,
          script,
          completesChapter: args.completesChapter === true,
          kind,
          minimumActorTurns,
          maximumActorTurns,
          contextIds,
          actorIds,
          sourceEventIds,
          sourceBasis: sourceChunkIds.length > 0 && sourceBindingRevision
            ? {
                bundleId: sourceBundleId!,
                bindingRevision: sourceBindingRevision,
                chunkIds: sourceChunkIds,
                adherence: (sourceAdherence ?? "adapt") as "follow" | "adapt" | "diverge",
                note: optionalString(args.sourceNote),
              }
            : undefined,
        });
        return success("Beat staged.");
      }
      case "link_beats": {
        const fromBeatRef = requiredString(args.fromBeatRef, "fromBeatRef");
        const toBeatRef = requiredString(args.toBeatRef, "toBeatRef");
        const fromBeatId = resolveReference(references, "beat", fromBeatRef);
        const toBeatId = resolveReference(references, "beat", toBeatRef);
        if (!fromBeatId || !host.validateBeatId(fromBeatId, mutations)) return unknownReference("Beat", fromBeatRef, references, "beat");
        if (!toBeatId || !host.validateBeatId(toBeatId, mutations)) return unknownReference("Beat", toBeatRef, references, "beat");
        const edgeType = requiredString(args.edgeType, "edgeType");
        const validEdgeTypes = ["causes", "enables", "contradicts", "escalates", "resolves", "returns_to"];
        if (!validEdgeTypes.includes(edgeType)) return failure(`Invalid edge type: ${edgeType}`);
        mutations.push({
          type: "link_beats",
          id: host.nextId(),
          fromBeatId,
          toBeatId,
          edgeType: edgeType as NarrativeEdgeType,
          description: optionalString(args.description),
        });
        return success("Beat link staged.");
      }
      case "advance_world_time": {
        mutations.push({
          type: "advance_world_time",
          seconds: clampNumber(args.seconds, 0, 1, 31_536_000),
          reason: optionalString(args.reason),
        });
        return success("World time advance staged.");
      }
      case "dismiss_spawned_actor": {
        const actorRef = requiredString(args.actorRef, "actorRef");
        const contextRef = requiredString(args.contextRef, "contextRef");
        const actorId = resolveReference(references, "actor", actorRef);
        const contextId = resolveReference(references, "context", contextRef);
        if (!actorId) return unknownReference("Actor", actorRef, references, "actor");
        if (!contextId) return unknownReference("Context", contextRef, references, "context");
        const validationError = host.validateSpawnedActor(actorId, contextId);
        if (validationError) return failure(validationError);
        mutations.push({
          type: "dismiss_spawned_actor",
          actorId,
          contextId,
          reason: limitedString(args.reason, "reason", 240),
        });
        return success("Scene Actor dismissal staged.");
      }
      case "set_actor_participation": {
        const actorRef = requiredString(args.actorRef, "actorRef");
        const contextRef = requiredString(args.contextRef, "contextRef");
        const actorId = resolveReference(references, "actor", actorRef);
        const contextId = resolveReference(references, "context", contextRef);
        if (!actorId || !host.validateActorId(actorId)) return unknownReference("Actor", actorRef, references, "actor");
        if (!contextId || !host.validateContextId(contextId)) return unknownReference("Context", contextRef, references, "context");
        if (!host.canControlActor(actorId, "participation")) {
          return failure(`Participation control is not permitted for actor: ${actorId}`);
        }
        const participation = requiredString(args.participation, "participation");
        if (!["joined", "muted", "left"].includes(participation)) {
          return failure(`Invalid participation: ${participation}`);
        }
        mutations.push({
          type: "set_actor_participation",
          actorId,
          contextId,
          participation: participation as ContextParticipation,
          reason: optionalString(args.reason),
        });
        return success("Actor participation change staged.");
      }
      case "set_actor_presence": {
        const actorRef = requiredString(args.actorRef, "actorRef");
        const actorId = resolveReference(references, "actor", actorRef);
        if (!actorId || !host.validateActorId(actorId)) return unknownReference("Actor", actorRef, references, "actor");
        if (!host.canControlActor(actorId, "presence")) {
          return failure(`Presence control is not permitted for actor: ${actorId}`);
        }
        const presence = requiredString(args.presence, "presence");
        if (!["online", "away", "offline"].includes(presence)) {
          return failure(`Invalid presence: ${presence}`);
        }
        mutations.push({
          type: "set_actor_presence",
          actorId,
          presence: presence as ActorPresence,
          status: optionalString(args.status),
          reason: optionalString(args.reason),
        });
        return success("Actor presence change staged.");
      }
      case "finish":
        return { output: "Planning pass finished.", accepted: true, finished: true };
      default:
        return failure(`Unsupported tool: ${call.function.name}`);
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

export function isLookupTool(name: string): boolean {
  return name === "inspect_context" || name === "query_narrative" || name === "query_actors" || isSourceLookupTool(name);
}
export function isSourceLookupTool(name: string): boolean {
  return name === "retrieve_source";
}
function sourceChunkKey(bundleId: string, chunkId: string): string {
  return `${bundleId}\u0000${chunkId}`;
}
function parseArgs(call: ToolCall): Record<string, unknown> {
  const parsed = parseToolArguments(call.function.arguments);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be an object.");
  }
  return parsed as Record<string, unknown>;
}
function parseToolArguments(raw: string): unknown {
  const candidate = raw.trim();
  try {
    return JSON.parse(candidate) as unknown;
  } catch (error) {
    const firstObject = extractFirstJsonObject(candidate);
    if (!firstObject) throw error;
    return JSON.parse(firstObject) as unknown;
  }
}
function extractFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}") {
      depth--;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}
function parseSceneActors(
  value: unknown,
  host: WorldDirectorHost,
  fallbackSourceEventIds: readonly string[],
  references: DirectorReferenceTable,
): { actors: NarrativeBeatSceneActor[]; aliases: Map<string, string> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("script must be an object.");
  }
  const rawSceneActors = (value as Record<string, unknown>).sceneActors;
  if (rawSceneActors == null) return { actors: [], aliases: new Map() };
  if (!Array.isArray(rawSceneActors)) throw new Error("script.sceneActors must be an array.");
  if (rawSceneActors.length > 8) throw new Error("script.sceneActors must contain at most 8 Actors.");
  const actors: NarrativeBeatSceneActor[] = [];
  const aliases = new Map<string, string>();
  for (const [index, raw] of rawSceneActors.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`script.sceneActors[${index}] must be an object.`);
    }
    const item = raw as Record<string, unknown>;
    const ref = limitedString(item.ref, `script.sceneActors[${index}].ref`, 80);
    if (aliases.has(ref)) throw new Error(`Duplicate scene Actor ref: ${ref}`);
    if (references.isReservedReference(ref)) throw new Error(`Scene Actor ref is reserved: ${ref}`);
    const contextRef = requiredString(item.contextRef, `script.sceneActors[${index}].contextRef`);
    const contextId = resolveReference(references, "context", contextRef);
    if (!contextId || !host.validateContextId(contextId)) {
      throw new Error("Unknown Context reference for script.sceneActors. Use an exact C* reference.");
    }
    const name = limitedString(item.name, `script.sceneActors[${index}].name`, 40);
    const validationError = host.validateSpawnActor(contextId, name);
    if (validationError) throw new Error(validationError);
    const requestedSourceEventIds = strictStringArray(item.eventRefs, `script.sceneActors[${index}].eventRefs`);
    const sourceEventIds = requestedSourceEventIds.length > 0
      ? resolveEventIds(requestedSourceEventIds, host.validateEventId, references)
      : [...fallbackSourceEventIds];
    if (sourceEventIds.length === 0) {
      throw new Error(`script.sceneActors[${index}].eventRefs cannot be empty.`);
    }
    const actorId = host.nextId();
    aliases.set(ref, actorId);
    actors.push({
      actorId,
      contextId,
      name,
      role: limitedString(item.role, `script.sceneActors[${index}].role`, 120),
      personality: limitedString(item.personality, `script.sceneActors[${index}].personality`, 240),
      objective: limitedString(item.objective, `script.sceneActors[${index}].objective`, 240),
      entrance: limitedString(item.entrance, `script.sceneActors[${index}].entrance`, 240),
      required: item.required === true,
      sourceEventIds,
    });
  }
  return { actors, aliases };
}

function parseBeatStages(
  value: unknown,
  development: readonly string[],
  turningPoint: unknown,
  result: unknown,
): NarrativeBeatScript["stages"] {
  if (value == null) {
    return [
      {
        id: "setup",
        purpose: "建立本幕局面与即时责任。",
        entryCondition: "Beat 开始且 cause 已成立。",
        developments: [development[0] ?? "当前局面被明确呈现。"],
        expectedChange: "参与者明确面对本幕的实际问题。",
      },
      {
        id: "development",
        purpose: "让主线发生连续的可观察发展。",
        entryCondition: "setup 的责任已经被承担。",
        developments: development.slice(1, -1).length > 0 ? development.slice(1, -1) : development.slice(0, 1),
        expectedChange: "至少一项新信息、行动或限制成立。",
      },
      {
        id: "complication",
        purpose: "引入改变选择空间的障碍或转折。",
        entryCondition: "development 已产生新的局面。",
        developments: [typeof turningPoint === "string" ? turningPoint : "转折改变了可用选择。"],
        expectedChange: "角色必须面对不同于开幕时的选择空间。",
      },
      {
        id: "resolution",
        purpose: "落实本幕结果并交出下一幕压力。",
        entryCondition: "complication 已经改变局面。",
        developments: [typeof result === "string" ? result : "本幕结果成为可观察事实。"],
        expectedChange: "result 已经发生并能被下一幕读取。",
      },
    ];
  }
  if (!Array.isArray(value) || value.length < 3 || value.length > 6) {
    throw new Error("script.stages must contain 3-6 stages.");
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`script.stages[${index}] must be an object.`);
    }
    const stage = raw as Record<string, unknown>;
    const developments = stringArray(stage.developments);
    if (developments.length === 0 || developments.length > 4) {
      throw new Error(`script.stages[${index}].developments must contain 1-4 items.`);
    }
    return {
      id: limitedString(stage.id, `script.stages[${index}].id`, 60),
      purpose: limitedString(stage.purpose, `script.stages[${index}].purpose`, 240),
      entryCondition: limitedString(stage.entryCondition, `script.stages[${index}].entryCondition`, 240),
      developments,
      expectedChange: limitedString(stage.expectedChange, `script.stages[${index}].expectedChange`, 240),
    };
  });
}

function parseNewChapter(value: unknown): { title: string; treatment: string; targetOutcome: string } | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("newChapter must be an object.");
  }
  const record = value as Record<string, unknown>;
  const title = limitedString(record.title, "newChapter.title", 160);
  const treatment = limitedString(record.treatment, "newChapter.treatment", 1_500);
  const targetOutcome = limitedString(record.targetOutcome, "newChapter.targetOutcome", 500);
  if ([...treatment].length < 600) throw new Error("newChapter.treatment must be at least 600 characters.");
  return { title, treatment, targetOutcome };
}

function optionalBeatKind(value: unknown): "full_scene" | "transition" | "coda" | undefined {
  const kind = optionalString(value);
  if (kind == null) return undefined;
  if (kind !== "full_scene" && kind !== "transition" && kind !== "coda") {
    throw new Error("kind must be full_scene, transition, or coda.");
  }
  return kind;
}

function requiredString(value: unknown, name: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function requiredBeatScript(
  value: unknown,
  actorIds: readonly string[],
  sceneActorAliases: ReadonlyMap<string, string> = new Map(),
  sceneActors: readonly NarrativeBeatSceneActor[] = [],
  declaredActorRefs: readonly string[] = [],
  references?: DirectorReferenceTable,
): Extract<WorldDirectorMutation, { type: "plan_beat" }>["script"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("script must be an object.");
  }
  const script = value as Record<string, unknown>;
  const development = stringArray(script.development).map((item) => item.trim()).filter(Boolean);
  if (development.length < 3 || development.length > 6) {
    throw new Error("script.development must contain 3-6 developments.");
  }
  const causalChain = stringArray(script.causalChain).map((item) => item.trim()).filter(Boolean);
  if (causalChain.length < 3 || causalChain.length > 8) {
    throw new Error("script.causalChain must contain 3-8 links.");
  }
  if (!Array.isArray(script.cast) || script.cast.length === 0) {
    throw new Error("script.cast must contain at least one participant.");
  }
  const castRefs = script.cast.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`script.cast[${index}] must be an object.`);
    }
    const item = value as Record<string, unknown>;
    const actorRef = requiredString(item.actorRef, `script.cast[${index}].actorRef`);
    const actorId = sceneActorAliases.get(actorRef)
      ?? (references ? references.resolve("actor", actorRef) : undefined);
    if (!actorId || !actorIds.includes(actorId)) throw new Error(`script.cast references an Actor outside actorRefs: ${actorRef}`);
    return { actorRef, actorId, roleInScene: requiredString(item.roleInScene, `script.cast[${index}].roleInScene`) };
  });
  const expectedRefs = new Set(declaredActorRefs);
  const actualRefs = new Set(castRefs.map((member) => member.actorRef));
  if (
    actualRefs.size !== castRefs.length ||
    expectedRefs.size !== actualRefs.size ||
    [...expectedRefs].some((ref) => !actualRefs.has(ref))
  ) {
    throw new Error("script.cast.actorRef must exactly match actorRefs.");
  }
  const cast = castRefs.map(({ actorId, roleInScene }) => ({ actorId, roleInScene }));
  const stages = parseBeatStages(script.stages, development, script.turningPoint, script.result);
  return {
    time: requiredString(script.time, "script.time"),
    location: requiredString(script.location, "script.location"),
    cast,
    cause: requiredString(script.cause, "script.cause"),
    development,
    turningPoint: requiredString(script.turningPoint, "script.turningPoint"),
    result: requiredString(script.result, "script.result"),
    causalChain,
    sceneActors: sceneActors.map((actor) => ({ ...actor, sourceEventIds: [...actor.sourceEventIds] })),
    openingState: optionalString(script.openingState),
    objective: optionalString(script.objective),
    conflict: optionalString(script.conflict),
    stakes: optionalString(script.stakes),
    stages,
    climax: optionalString(script.climax),
    nextPressure: optionalString(script.nextPressure),
  };
}

function limitedString(value: unknown, name: string, maxLength: number): string {
  const result = requiredString(value, name);
  if ([...result].length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters.`);
  }
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = optionalNumber(value) ?? fallback;
  return Math.max(min, Math.min(max, parsed));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => (
    typeof item === "string" && Boolean(item.trim())
  )).map((item) => item.trim()))];
}

function strictStringArray(value: unknown, name: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of strings.`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${name} must contain only non-empty strings.`);
    }
    const normalized = item.trim();
    if (seen.has(normalized)) throw new Error(`${name} must not contain duplicate references.`);
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveEventIds(
  value: unknown,
  validate: (id: string) => boolean,
  references: DirectorReferenceTable,
): string[] {
  const candidates = strictStringArray(value, "eventRefs");
  if (candidates.length === 0) return [];
  return [...new Set(candidates.map((candidate) => {
    const resolved = references.resolve("event", candidate);
    if (!resolved || !validate(resolved)) {
      throw new Error("Unknown Event reference. Use an exact E* reference from this request.");
    }
    return resolved;
  }))];
}

function resolveTrustedIds(
  value: readonly string[],
  validate: (id: string) => boolean,
): string[] {
  const ids = [...new Set(value)];
  if (ids.some((id) => !validate(id))) return [];
  return ids;
}

function resolveReference(
  references: DirectorReferenceTable,
  kind: Parameters<DirectorReferenceTable["refFor"]>[0],
  reference: string,
): string | undefined {
  return references.resolve(kind, reference);
}

function resolveReferenceList(
  value: unknown,
  references: DirectorReferenceTable,
  kind: Parameters<DirectorReferenceTable["refFor"]>[0],
  validate: (id: string) => boolean,
  label: string,
): string[] {
  const candidates = strictStringArray(value, `${label.toLowerCase()}Refs`);
  return [...new Set(candidates.map((candidate) => {
    const resolved = resolveReference(references, kind, candidate);
    if (!resolved || !validate(resolved)) {
      throw new Error(`Unknown ${label} reference. Use an exact ${references.refs(kind)[0]?.replace(/\d+$/, "*") ?? `${label}*`} reference from this request.`);
    }
    return resolved;
  }))];
}

function resolveActorReferences(
  actorRefs: readonly string[],
  references: DirectorReferenceTable,
  sceneActorAliases: ReadonlyMap<string, string>,
  validate: (id: string) => boolean,
): string[] {
  return [...new Set(actorRefs.map((actorRef) => {
    const sceneActorId = sceneActorAliases.get(actorRef);
    if (sceneActorId) return sceneActorId;
    const actorId = references.resolve("actor", actorRef);
    if (!actorId || !validate(actorId)) {
      throw new Error("Unknown Actor reference. Use an exact A* reference or a local scene Actor ref.");
    }
    return actorId;
  }))];
}

function unknownReference(
  label: string,
  _reference: string,
  references: DirectorReferenceTable,
  kind: Parameters<DirectorReferenceTable["refFor"]>[0],
): ToolExecutionResult {
  const available = references.refs(kind);
  return failure(
    `Unknown ${label} reference. Use one exact ${available[0]?.replace(/\d+$/, "*") ?? `${label}*`} reference from this request${available.length ? ` (${available.join(", ")})` : ""}.`,
  );
}

function success(output: string): ToolExecutionResult {
  return { output, accepted: true };
}

function failure(message: string): ToolExecutionResult {
  return { output: `Error: ${message}`, accepted: false };
}
