import type {
  CharacterCard,
  LoreBook,
  Relation,
  SceneCard,
} from "../contracts/chat.js";
import type { HumanParticipant } from "../engine/input/types.js";
import type { GroupRuntimeConfig } from "./runtime-config.js";

export interface GroupMetadata {
  id?: string;
  name: string;
  description?: string;
  avatar?: string;
  cover?: string;
  version?: string;
  author?: string;
  tags?: string[];
}

export interface UserProfileCard extends HumanParticipant {
  id?: string;
  avatar?: string;
  role?: string;
  preferences?: string;
  boundaries?: string;
}

export interface RelationGraph {
  relations: Relation[];
}

/**
 * A GroupCard can be a materialized view of one chat context in a World.
 * The reference keeps the parent identity without copying runtime history.
 */
export interface GroupWorldReference {
  worldId: string;
  contextId: string;
}

export interface GroupCard {
  kind: "chatverse.group";
  schemaVersion: 1;
  metadata: GroupMetadata;
  /** Optional when the group is authored before being attached to a World. */
  worldRef?: GroupWorldReference;
  characters: CharacterCard[];
  userProfiles?: UserProfileCard[];
  scene: SceneCard;
  worldBook?: LoreBook;
  relations?: RelationGraph;
  /** Persistent defaults for how this group runs. Safe to export with the group card. */
  runtime?: GroupRuntimeConfig;
}

export function defineGroupCard(
  input: Omit<GroupCard, "kind" | "schemaVersion"> & {
    kind?: "chatverse.group";
    schemaVersion?: 1;
  },
): GroupCard {
  assertText(input.metadata.name, "metadata.name");
  assertText(input.scene.groupName, "scene.groupName");
  assertText(input.scene.topic, "scene.topic");
  assertText(input.scene.atmosphere, "scene.atmosphere");
  input.characters.forEach((character, index) => assertCharacter(character, index));
  input.relations?.relations.forEach((relation, index) => assertRelation(relation, index));

  return {
    ...structuredClone(input),
    kind: "chatverse.group",
    schemaVersion: 1,
    metadata: {
      version: "1.0.0",
      ...structuredClone(input.metadata),
    },
    scene: structuredClone(input.scene),
    characters: structuredClone(input.characters),
    userProfiles: normalizeUsers(input.userProfiles),
    relations: structuredClone(input.relations ?? { relations: [] }),
    runtime: input.runtime ?? {},
  };
}

function normalizeUsers(users: UserProfileCard[] | undefined): UserProfileCard[] {
  if (!users?.length) return [{ name: "你", card: "群聊成员" }];
  users.forEach((user, index) => {
    assertText(user.name, `userProfiles[${index}].name`);
    if (user.card !== undefined) assertText(user.card, `userProfiles[${index}].card`, true);
  });
  return structuredClone(users);
}

function assertCharacter(character: CharacterCard, index: number): void {
  assertText(character.name, `characters[${index}].name`);
  assertText(character.description, `characters[${index}].description`, true);
  assertText(character.personality, `characters[${index}].personality`, true);
  assertText(character.scenario, `characters[${index}].scenario`, true);
  assertText(character.messageExample, `characters[${index}].messageExample`, true);
}

function assertRelation(relation: Relation, index: number): void {
  assertText(relation.from, `relations[${index}].from`);
  assertText(relation.to, `relations[${index}].to`);
  assertText(relation.description, `relations[${index}].description`);
}

function assertText(value: string, path: string, allowEmpty = false): void {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`GroupCard ${path} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
}
