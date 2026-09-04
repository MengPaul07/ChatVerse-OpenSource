import type { ActorVisualProfile, CharacterCard } from "../chat.js";
import type { ActorMemoryDefinition } from "../actor-memory.js";

export interface PlayerCharacterCard {
  name: string;
  identity: string;
  background: string;
  personality: string;
  appearance: string;
  speechStyle: string;
  boundaries: string;
  visual?: ActorVisualProfile;
}

export type ActorPresence = "online" | "away" | "offline";
export type ContextParticipation = "joined" | "muted" | "left";
export type WorldDirectorActorAuthority = "observe" | "coordinate" | "manage";
export type ActorStateSource = "actor" | "director" | "user" | "system";

export interface WorldRelation {
  fromActorId: string;
  toActorId: string;
  description: string;
}

export interface WorldActorControlPolicy {
  directorAuthority?: WorldDirectorActorAuthority;
}

export interface ResolvedWorldActorControlPolicy {
  directorAuthority: WorldDirectorActorAuthority;
}

/** Durable world-level state. Scheduler timing and model intent do not belong here. */
export interface WorldActorState {
  actorId: string;
  presence: ActorPresence;
  status?: string;
  revision: number;
  updatedAt: number;
}

/** Director-maintained, world-specific Actor situation summary. */
export interface WorldActorBackgroundState {
  actorId: string;
  text: string;
  revision: number;
  sourceEventIds: string[];
  /** Highest supporting WorldEvent sequence used by the latest rewrite. */
  updatedAtSequence: number;
  updatedAt: number;
}

export interface WorldActorControlState {
  actorId: string;
  policy: ResolvedWorldActorControlPolicy;
  updatedAt: number;
}

/** Context-local participation. Harness idle/generation timing remains private runtime state. */
export interface ContextPresenceState {
  actorId: string;
  contextId: string;
  participation: ContextParticipation;
  /** World event sequence at which the actor most recently joined this context. */
  joinedAtSequence: number;
  lastSeenSequence: number;
  updatedAt: number;
}

export interface WorldAiActorDefinition {
  id: string;
  kind: "character";
  card: CharacterCard;
  /** The Actor is performed by the user instead of the Character Provider. */
  playerControlled?: boolean;
  /** Private player authorship data used for proposals and public projection. */
  playerCard?: PlayerCharacterCard;
  /** Scene Actors are lightweight Director-spawned roles, not reusable character cards. */
  lifecycle?: "persistent" | "scene";
  /** Initial world-specific background. Falls back to card.scenario. */
  background?: string;
  /** Shareable seed memories. Runtime evolution is stored in World snapshots. */
  memory?: ActorMemoryDefinition;
  initialState?: Partial<Omit<WorldActorState, "actorId" | "revision" | "updatedAt">>;
  control?: WorldActorControlPolicy;
}

export type WorldActorDefinition = WorldAiActorDefinition;
