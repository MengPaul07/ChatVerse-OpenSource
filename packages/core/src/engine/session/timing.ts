import type { CharacterState } from "../../contracts/chat.js";
import { clamp, randomJitter, stableJitter } from "./helpers.js";

export interface IdleCooldownInput {
  characterName: string;
  characterCount: number;
  pacingMultiplier: number;
  state?: CharacterState;
  triggerType: "mention" | "event" | "idle" | "wake";
  triggerSource: "user" | "character" | "narrator" | "player_focus" | "player_direct";
  decision: "speak" | "silent";
  isClosingMessage: boolean;
  modelHintSec?: number;
}

export function computeTypingDelaySec(
  message: string,
  hesitationSec: number,
  pacingMultiplier: number,
): number {
  if (pacingMultiplier === 0) return 0;
  const BASE = 2;
  const CPS = 5;
  const charCount = [...message.trim()].length;
  const h = Math.max(0, Math.min(8, hesitationSec));
  const delay = (BASE + charCount / CPS + h) * pacingMultiplier;
  return clamp(delay, 1, 180);
}

export function computeActionDelaySec(
  action: string,
  hesitationSec: number,
  pacingMultiplier: number,
): number {
  if (pacingMultiplier === 0) return 0;
  const charCount = [...action.trim()].length;
  const delay = (
    0.8
    + charCount / 12
    + Math.max(0, Math.min(4, hesitationSec))
  ) * pacingMultiplier;
  return clamp(delay, 0.5, 60);
}

export function computePassiveIdleBackoffSec(
  state: CharacterState | undefined,
  characterCount: number,
  pacingMultiplier: number,
): number {
  if (pacingMultiplier === 0) return 0;
  const crowd = crowdIdleFactor(characterCount);
  const base = state?.attention === "active"
    ? 45
    : state?.attention === "lurking"
      ? 150
      : 90;
  const scaled = base * crowd * pacingMultiplier;
  return Math.round(clamp(scaled + randomJitter(scaled * 0.6), 30, 900));
}

export function computeInitialIdleSec(
  state: CharacterState | undefined,
  characterCount: number,
  pacingMultiplier: number,
): number {
  if (pacingMultiplier === 0) return 0;
  const crowd = crowdIdleFactor(characterCount);
  const base = state?.attention === "active"
    ? 4
    : state?.attention === "lurking"
      ? 14
      : 8;
  const scaled = base * crowd * pacingMultiplier;
  return Math.round(clamp(scaled + randomJitter(scaled * 0.6), 2, 30));
}

export function computeIdleCooldownSec(args: IdleCooldownInput): number {
  const { characterName, state, triggerType, triggerSource, decision, isClosingMessage, modelHintSec } = args;
  const pacingMultiplier = args.pacingMultiplier;
  if (pacingMultiplier === 0) return 0;

  let base: number;
  if (decision === "speak") {
    if (triggerType === "mention" && triggerSource === "user") base = 28;
    else if (triggerType === "mention") base = 40;
    else if (triggerType === "event" || triggerType === "wake") base = 42;
    else if (isClosingMessage) base = 75;
    else base = 60;
  } else {
    if (triggerType === "mention") base = 35;
    else if (triggerType === "event" || triggerType === "wake") base = 55;
    else base = 90;
  }

  const attentionPart = state?.attention === "active"
    ? -10
    : state?.attention === "lurking"
      ? 30
      : state?.attention === "distracted"
        ? 45
        : 0;
  const hintPart = typeof modelHintSec === "number" ? clamp(modelHintSec, 20, 180) * 0.15 : 0;
  const idleTrigger = triggerType === "idle";
  const runtimePart = (
    base + attentionPart
  ) * (idleTrigger ? crowdIdleFactor(args.characterCount) : 1) * pacingMultiplier;
  const blended = typeof modelHintSec === "number" ? runtimePart * 0.85 + hintPart : runtimePart;
  const jitterRange = idleTrigger
    ? Math.max(8, blended * (decision === "silent" ? 0.75 : 0.5))
    : Math.max(3, base * 0.15);
  const jitter = idleTrigger
    ? randomJitter(jitterRange)
    : stableJitter(`${characterName}:${decision}:${triggerType}`, jitterRange);
  const maxIdle = idleTrigger ? 900 : 600;
  return Math.round(clamp(blended + jitter, 20, maxIdle));
}

export function crowdIdleFactor(characterCount: number): number {
  const count = Math.max(1, characterCount);
  return clamp(Math.sqrt(count / 3), 1, 2.4);
}

export function isClosingMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length <= 8) return true;
  return /^(好的|嗯|对|没错|是的|行|OK|好[吧了]|可以|明白了|知道了|收到)[。！!~～]*$/.test(trimmed);
}
