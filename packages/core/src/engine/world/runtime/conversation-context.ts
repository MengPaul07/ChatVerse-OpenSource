import type {
  WorldCreateChatContextInput,
  WorldContextDefinition,
  WorldEvent,
  WorldEventInput,
  WorldNotificationPayloadMap,
  WorldNotificationType,
} from "../../../contracts/world.js";
import type { RuntimeHost } from "../../../runtime/types.js";
import type { WorldContextRuntimeFactory } from "./context-factory.js";
import type { WorldState } from "../state.js";
import type { WorldActorDefinition } from "../../../contracts/world/actors.js";
import {
  actorDisplayName,
  isPlayerControlledActor,
  isPrivateConversationContext,
} from "../persistence/definition.js";

interface ConversationContextHost {
  state: WorldState;
  runtime: RuntimeHost;
  contextRuntimeFactory: Pick<WorldContextRuntimeFactory, "create">;
  getStatus(): "idle" | "running" | "paused" | "stopped";
  requireActor(actorId: string): WorldActorDefinition;
  appendEvent(input: WorldEventInput<"narrative.narration.committed">): WorldEvent;
  notify<TType extends WorldNotificationType>(
    type: TType,
    payload: WorldNotificationPayloadMap[TType],
  ): void;
  activateContext(contextId: string): void;
}

/** Creates isolated chat Contexts while keeping World Actor state shared. */
export class ConversationContextCreator {
  constructor(private readonly host: ConversationContextHost) {}

  create(input: WorldCreateChatContextInput): WorldContextDefinition {
    if (this.host.getStatus() === "stopped") {
      throw new Error("Cannot create a chat context in a stopped world.");
    }
    const human = this.host.requireActor(input.humanActorId);
    if (!isPlayerControlledActor(human)) {
      throw new Error(`Actor ${input.humanActorId} is not player-controlled.`);
    }
    const actorIds = [...new Set(input.actorIds.map((actorId) => actorId.trim()).filter(Boolean))];
    if (actorIds.length === 0) throw new Error("A chat context needs at least one AI Actor.");
    const actors = actorIds.map((actorId) => this.host.requireActor(actorId));
    if (actors.some((actor) => isPlayerControlledActor(actor))) {
      throw new Error("A chat context can only invite AI character Actors.");
    }
    if (actorIds.includes(human.id)) throw new Error("A chat context needs different human and AI Actors.");

    const isPrivate = input.conversationMode === "private";
    if (isPrivate && actorIds.length !== 1) {
      throw new Error("A private context needs exactly one AI Actor.");
    }
    const existing = isPrivate
      ? this.host.state.definition.contexts.find((context) => (
        context.conversationMode === "private" &&
        context.actorIds.includes(human.id) &&
        context.actorIds.includes(actorIds[0]!)
      ))
      : undefined;
    if (existing) return existing;

    const firstActor = actors[0]!;
    const contextId = isPrivate
      ? `private:${human.id}:${firstActor.id}`
      : `group:${this.host.runtime.idGenerator.next()}`;
    const name = input.name?.trim() || (
      isPrivate ? `与 ${actorDisplayName(firstActor)} 的私聊` : "新的聊天群"
    );
    const context: WorldContextDefinition = {
      id: contextId,
      kind: "chat",
      conversationMode: input.conversationMode,
      name,
      actorIds: [human.id, ...actorIds],
      scene: {
        groupName: name,
        topic: input.topic?.trim() || (
          isPrivate ? "一段只属于你们两人的对话" : "一个由你发起的新聊天空间"
        ),
        atmosphere: isPrivate ? "安静、没有旁观者打扰" : "自然、有人愿意接话的聊天现场",
        state: "flowing",
      },
      runtime: {
        actorRuntime: {
          activation: isPrivate ? "beat_runtime" : "autonomous_idle",
          playerRouting: "focus_actor",
          ambient: "off",
        },
      },
      initiallyActive: true,
    };

    const projected = this.host.state.addContext(context, this.host.runtime);
    const focusActorIds = actorIds.slice(0, 2);
    projected.activity!.focusActorIds = focusActorIds;
    const contextState = this.host.state.contexts.get(context.id);
    if (contextState?.activity) contextState.activity.focusActorIds = focusActorIds;
    this.host.appendEvent({
      type: "narrative.narration.committed",
      contextId: context.id,
      payload: { narration: projected.scene },
    });
    this.host.contextRuntimeFactory.create(context);
    this.host.notify("context.focus_changed", {
      contextId: context.id,
      focusActorIds,
      reason: isPrivate ? "private_context_created" : "group_context_created",
    });
    // Conversation contexts own their lifecycle. A running World starts a new
    // Group immediately; otherwise the user can start it independently.
    if (this.host.getStatus() === "running" && !isPrivateConversationContext(context)) {
      this.host.activateContext(context.id);
    }
    return context;
  }
}
