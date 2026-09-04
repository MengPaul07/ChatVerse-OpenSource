import type { ToolDefinition } from "../../../contracts/provider.js";
import type {
  ActorPresence,
  ContextParticipation,
  NarrativeEdgeType,
  NarrativeBeatScript,
  WorldDirectorActorAuthority,
  WorldSourceAdherence,
} from "../../../contracts/world.js";

export type WorldDirectorTaskMode =
  | "plan_beat"
  | "transition_beat"
  | "player_directive";

export type WorldDirectorMutation =
  | {
      type: "update_actor_background";
      actorId: string;
      text: string;
      sourceEventIds: string[];
    }
  | {
      type: "emit_world_event";
      message: string;
      contextIds: string[];
      actorIds: string[];
      correlationId?: string;
    }
  | {
      type: "plan_beat";
      id: string;
      chapterId: string;
      newChapter?: {
        title: string;
        treatment: string;
        targetOutcome: string;
      };
      title: string;
      brief: string;
      script: NarrativeBeatScript;
      completesChapter: boolean;
      kind?: "full_scene" | "transition" | "coda";
      minimumActorTurns: number;
      maximumActorTurns: number;
      contextIds: string[];
      actorIds: string[];
      sourceEventIds: string[];
      sourceBasis?: {
        bundleId: string;
        bindingRevision: number;
        chunkIds: string[];
        adherence: WorldSourceAdherence;
        note?: string;
      };
    }
  | {
      type: "link_beats";
      id: string;
      fromBeatId: string;
      toBeatId: string;
      edgeType: NarrativeEdgeType;
      description?: string;
    }
  | {
      type: "advance_world_time";
      seconds: number;
      reason?: string;
    }
  | {
      type: "dismiss_spawned_actor";
      actorId: string;
      contextId: string;
      reason: string;
    }
  | {
      type: "set_actor_participation";
      actorId: string;
      contextId: string;
      participation: ContextParticipation;
      reason?: string;
    }
  | {
      type: "set_actor_presence";
      actorId: string;
      presence: ActorPresence;
      status?: string;
      reason?: string;
    };

const BASE_WORLD_DIRECTOR_TOOLS: ToolDefinition[] = [
  tool("inspect_context", "Read recent committed messages from one context only when the previous Beat outcome is insufficient.", {
    contextRef: stringProperty("Context reference (C*) from the Context index."),
    limit: numberProperty("Number of recent messages, 1-20."),
  }, ["contextRef"]),
  tool("query_narrative", "Read older Chapters, Beats, and their edges on demand. Recent graph state is already supplied in the prompt.", {
    query: stringProperty("Optional title, summary keyword, Actor name, or Context name. Use dedicated typed references for exact selection."),
    chapterRef: stringProperty("Optional exact Chapter reference (CH*)."),
    beatRef: stringProperty("Optional exact Beat reference (B*)."),
    limit: numberProperty("Maximum matching Chapters or Beats, 1-20."),
  }),
  tool("query_actors", "Read one Actor by id, or search the registered Actor catalog without loading every Actor into the prompt.", {
    actorRef: stringProperty("Optional exact Actor reference (A*). When provided, returns that Actor's public runtime details."),
    query: stringProperty("Optional name, description, or status text used when actorRef is omitted."),
    contextRef: stringProperty("Optional exact Context reference (C*) used to include local participation."),
    limit: numberProperty("Maximum results, 1-20."),
  }),
  tool("update_actor_background", "Replace one AI Actor's concise world-specific background after a durable change in role, location, obligations, or established knowledge. This is low-frequency state, not a turn summary, mood, hidden thought, personality rewrite, or event log.", {
    actorRef: stringProperty("Actor reference (A*) whose world-specific background changed."),
    text: stringProperty("Complete replacement background, preferably 1-3 concise sentences and at most 600 characters."),
    eventRefs: stringArrayProperty("Exact Event references (E*) directly supporting the change."),
  }, ["actorRef", "text", "eventRefs"]),
  tool("emit_world_event", "Introduce an external condition or piece of information. Never write dialogue or decide a character action.", {
    message: stringProperty("Concise external fact or condition."),
    contextRefs: stringArrayProperty("Context references (C*) that can observe this event."),
    actorRefs: stringArrayProperty("Actor references (A*) directly notified by this event."),
    correlationId: stringProperty("Optional correlation id."),
  }, ["message"]),
  tool("plan_beat", "Plan exactly one complete playable scene inside the active Chapter. The script must establish a concrete causal chain and a meaningful contribution toward the Chapter targetOutcome. The Narrator and Actors execute it without another Director call. Scene-only Actors are prepared atomically in script.sceneActors.", {
    newChapter: {
      type: "object",
      description: "When no active or queued Chapter remains, atomically create and activate a new Chapter together with its first Beat. It must be large enough for about 4-8 Beats.",
      properties: {
        title: stringProperty("Chapter title."),
        treatment: stringProperty("600-1500 character Chapter treatment describing situation, conflict, forces, constraints, and room for progression."),
        targetOutcome: stringProperty("One observable, world-changing Chapter result."),
      },
      required: ["title", "treatment", "targetOutcome"],
      additionalProperties: false,
    },
    title: stringProperty("Short scene title."),
    brief: stringProperty("A concrete 4-8 sentence synopsis naming the time, place, participants, cause, major development, turning point, and result."),
    script: {
      type: "object",
      description: "Complete causal scene script. Predetermine the plot backbone without scripting exact dialogue or overriding character agency.",
      properties: {
        time: stringProperty("Concrete time, duration, or story phase."),
        location: stringProperty("Concrete location and relevant spatial boundary."),
        openingState: stringProperty("Observable state at the opening of the scene."),
        objective: stringProperty("What concrete progress this scene makes toward its owning Chapter targetOutcome."),
        conflict: stringProperty("The concrete force or disagreement preventing the objective."),
        stakes: stringProperty("What changes or is lost if the scene fails."),
        cast: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              actorRef: stringProperty("Exact A* reference or local sceneActors ref. It must byte-for-byte equal one actorRefs item."),
              roleInScene: stringProperty("What this participant is positioned to observe, decide, reveal, or do in this scene, without prescribing exact dialogue."),
            },
            required: ["actorRef", "roleInScene"],
            additionalProperties: false,
          },
        },
        cause: stringProperty("The already established event or condition that directly starts this scene."),
        development: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: { type: "string" },
          description: "Three to six ordered, concrete causal developments. Do not leave clues, identities, arrivals, or outcomes for the Narrator to invent.",
        },
        turningPoint: stringProperty("A concrete reveal, obstacle, arrival, result, or reversal that changes available choices."),
        result: stringProperty("The predetermined observable result that ends this scene and remains available to the next Beat."),
        causalChain: {
          type: "array",
          minItems: 3,
          maxItems: 8,
          items: { type: "string" },
          description: "Explicit cause-and-effect links connecting the cause, developments, turning point, and result.",
        },
        stages: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          description: "Ordered execution stages. Each stage must create a concrete change; do not use dialogue topics as stages.",
          items: {
            type: "object",
            properties: {
              id: stringProperty("Stable local stage id, such as setup, development, complication, resolution."),
              purpose: stringProperty("Dramatic purpose of this stage."),
              entryCondition: stringProperty("Observable condition required to enter this stage."),
              developments: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                items: { type: "string" },
              },
              expectedChange: stringProperty("Concrete state change that proves this stage is complete."),
            },
            required: ["id", "purpose", "entryCondition", "developments", "expectedChange"],
            additionalProperties: false,
          },
        },
        climax: stringProperty("The scene's highest-pressure action or decision."),
        nextPressure: stringProperty("A closing hook handed to the next Beat. It remains inactive until this Beat result is established and must not appear in this Beat's development, stages, turningPoint, climax, or result."),
        sceneActors: {
          type: "array",
          maxItems: 8,
          description: "Temporary Actors atomically prepared with this Beat. Use ref in cast to refer to one before Host assigns actorId.",
          items: {
            type: "object",
            properties: {
              ref: stringProperty("Unique local reference used by script.cast, not a runtime Actor id."),
              contextRef: stringProperty("Exact C* reference for the Context where this scene Actor appears."),
              name: stringProperty("Short unique display name, at most 40 characters."),
              role: stringProperty("Observable identity or role, without uncommitted testimony or conclusions."),
              personality: stringProperty("Concise temperament and speech cues."),
              objective: stringProperty("Immediate scene objective."),
              entrance: stringProperty("How this Actor becomes observable in the scene."),
              required: { type: "boolean", description: "Whether the planned causal chain requires this Actor to appear." },
              eventRefs: stringArrayProperty("Optional E* references supporting this Actor's appearance; Host uses current Beat events when omitted."),
            },
            required: ["ref", "contextRef", "name", "role", "personality", "objective", "entrance", "required"],
            additionalProperties: false,
          },
        },
      },
      required: ["time", "location", "cast", "cause", "development", "turningPoint", "result", "causalChain"],
      additionalProperties: false,
    },
    minimumActorTurns: {
      type: "number",
      description: "Natural-closure eligibility boundary measured in Actor/player turns. One wake burst or one player submission is one turn regardless of message count. Usually 10-14 for a full scene.",
    },
    maximumActorTurns: {
      type: "number",
      description: "Hard closure boundary measured in Actor/player turns. Usually 18-24 for a full scene and always greater than minimumActorTurns.",
    },
    kind: {
      type: "string",
      enum: ["full_scene", "transition", "coda"],
      description: "Narrative scale. Use full_scene for the default multi-stage playable scene.",
    },
    completesChapter: {
      type: "boolean",
      description: "True only when this Beat's predetermined result directly achieves the Chapter targetOutcome.",
    },
    contextRefs: stringArrayProperty("Exact C* references for every Context used by this Beat."),
    actorRefs: stringArrayProperty("Exact A* references and/or local scene Actor refs for every participant in script.cast."),
    sourceAdherence: {
      type: "string",
      enum: ["follow", "adapt", "diverge"],
      description: "How this Beat relates to the cited Source chunks.",
    },
    sourceNote: stringProperty("Optional concise explanation of the adaptation or divergence."),
  }, ["title", "brief", "script", "completesChapter", "minimumActorTurns", "maximumActorTurns", "contextRefs", "actorRefs"]),
  tool("link_beats", "Create a causal or dramatic edge between two existing or newly staged beats.", {
    fromBeatRef: stringProperty("Exact Beat reference (B*) for the source."),
    toBeatRef: stringProperty("Exact Beat reference (B*) for the target."),
    edgeType: {
      type: "string",
      enum: ["causes", "enables", "contradicts", "escalates", "resolves", "returns_to"],
    },
    description: stringProperty("Optional explanation."),
  }, ["fromBeatRef", "toBeatRef", "edgeType"]),
  tool("advance_world_time", "Advance fictional world time when an actual transition is warranted.", {
    seconds: numberProperty("Positive number of seconds to advance."),
    reason: stringProperty("Why time advances."),
  }, ["seconds"]),
];

const RETRIEVE_SOURCE_TOOL = tool("retrieve_source", "Search one bound Markdown World Source and return the full text of the best matching chunks in this tool result.", {
    sourceRef: stringProperty("Exact S* reference from the World Source catalog."),
    query: stringProperty("One focused causal query covering the facts needed to write the next Beat."),
    limit: numberProperty("Maximum full Markdown chunks to return, 1-8."),
  }, ["sourceRef", "query"]);

const COORDINATE_ACTOR_TOOLS: ToolDefinition[] = [
  tool("dismiss_spawned_actor", "Remove a scene-only Actor from its context after it leaves, is defeated, or is no longer relevant. Persistent Actors cannot be dismissed with this tool.", {
    actorRef: stringProperty("Exact A* reference for the scene-only Actor."),
    contextRef: stringProperty("Exact C* reference for the Context the Actor leaves."),
    reason: stringProperty("Observable reason for leaving."),
  }, ["actorRef", "contextRef", "reason"]),
  tool("set_actor_participation", "Join, mute, or remove an already-registered actor from one context when the control policy permits it.", {
    actorRef: stringProperty("Exact A* reference for the registered Actor."),
    contextRef: stringProperty("Exact C* reference for the Context."),
    participation: {
      type: "string",
      enum: ["joined", "muted", "left"],
    },
    reason: stringProperty("Why context participation changes."),
  }, ["actorRef", "contextRef", "participation"]),
];

const MANAGE_ACTOR_TOOLS: ToolDefinition[] = [
  tool("set_actor_presence", "Change an actor's global online presence only when explicit management authority permits it.", {
    actorRef: stringProperty("Exact A* reference for the Actor."),
    presence: {
      type: "string",
      enum: ["online", "away", "offline"],
    },
    status: stringProperty("Optional short public status."),
    reason: stringProperty("Why global presence changes."),
  }, ["actorRef", "presence"]),
];

const FINISH_TOOL = tool("finish", "Finish this macro planning pass after all useful changes are staged.", {
  reason: stringProperty("Optional concise reason."),
});

export function worldDirectorTools(
  authority: WorldDirectorActorAuthority,
  _mode: WorldDirectorTaskMode = "plan_beat",
  sourceEnabled = false,
): ToolDefinition[] {
  return [
    ...BASE_WORLD_DIRECTOR_TOOLS.filter((item) => item.function.name !== "plan_beat"),
    ...(sourceEnabled ? [RETRIEVE_SOURCE_TOOL] : []),
    ...(authority === "coordinate" || authority === "manage"
      ? COORDINATE_ACTOR_TOOLS
      : []),
    ...(authority === "manage" ? MANAGE_ACTOR_TOOLS : []),
    FINISH_TOOL,
  ];
}

/** Beat planning is a fixed two-round protocol: optional retrieval, then commit. */
export function worldDirectorBeatRoundTools(
  round: 0 | 1,
  sourceEnabled: boolean,
): ToolDefinition[] {
  if (round === 0) return sourceEnabled ? [RETRIEVE_SOURCE_TOOL] : [];
  const planBeat = BASE_WORLD_DIRECTOR_TOOLS.find((item) => (
    item.function.name === "plan_beat"
  ));
  return planBeat ? [planBeat] : [];
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required?: string[],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        ...(required?.length ? { required } : {}),
      },
    },
  };
}

function stringProperty(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function numberProperty(description: string): Record<string, unknown> {
  return { type: "number", description };
}

function stringArrayProperty(description: string): Record<string, unknown> {
  return { type: "array", items: { type: "string" }, description };
}
