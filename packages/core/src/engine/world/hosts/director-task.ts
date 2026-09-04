import type { WorldEvent } from "../../../contracts/world.js";
import { inferDirectorToolNames } from "../director/index.js";
import type {
  WorldDirectorTask,
  WorldDirectorTaskMode,
} from "../director/index.js";
import type { WorldState } from "../state.js";

export interface DirectorTaskPlan {
  taskMode?: WorldDirectorTaskMode;
  sourceEventIds?: readonly string[];
}

/** Derives the bounded Director objective from committed inputs and state. */
export class DirectorTaskBuilder {
  constructor(private readonly state: WorldState) {}

  build(
    events: readonly WorldEvent[],
    plan?: DirectorTaskPlan,
  ): WorldDirectorTask | undefined {
    const directives = events.filter((event): event is Extract<WorldEvent, { type: "player.directive" }> => (
      event.type === "player.directive"
    ));
    const isBootstrap = events.some((event) => (
      event.type === "world.progression.requested" && event.payload.reason === "bootstrap"
    ));
    const completedBeat = [...events].reverse().find((event): event is Extract<WorldEvent, { type: "narrative.beat.completed" }> => (
      event.type === "narrative.beat.completed" && event.payload.reason === "resolved"
    ));
    const progression = events.some((event) => (
      event.type === "world.progression.requested" ||
      event.type === "world.event.emitted" ||
      (event.type === "narrative.beat.completed" && event.payload.reason === "resolved")
    ));
    const needsChapter = this.state.chapters.size === 0 || ![...this.state.chapters.values()].some((chapter) => chapter.status === "active");
    if (directives.length === 0 && !progression && !isBootstrap && plan?.taskMode !== "transition_beat") {
      return undefined;
    }

    const mode: WorldDirectorTaskMode = plan?.taskMode
      ?? (directives.length > 0
        ? "player_directive"
        : completedBeat
          ? "transition_beat"
          : "plan_beat");
    const objectives: string[] = [];
    const requiredToolNames: string[] = [];
    if (needsChapter) {
      objectives.push([
        "先建立当前世界的章节地基。",
        "当前没有 active Chapter：在本次固定 Beat 工作流中用 newChapter 创建一个足够承载约 4-8 个 Beat 的大章节，并立即规划第一幕。",
        "Chapter treatment 必须说明局面、核心矛盾、主要力量、约束和推进空间；targetOutcome 必须是可观察且会改变世界状态的阶段性结果。",
      ].join(" "));
    } else if (completedBeat) {
      objectives.push([
        `上一幕「${completedBeat.payload.beat.title}」已经结束，所属 Chapter=${completedBeat.payload.beat.chapterId}，结果是：${completedBeat.payload.beat.outcome ?? "见已提交事实"}。`,
        "继续当前 active Chapter，除非它已完成；Chapter 完成后使用已经激活的下一章，不要为了轮换而切换。",
        "通过 Beat JSON 的 chapterId 明确所属 Chapter，并说明它为该 Chapter 增加的具体进展。",
      ].join(" "));
    } else {
      objectives.push("根据当前根事件规划一幕新的可执行剧情；不要把普通对话拆成 Beat。");
    }
    if (directives.length > 0) {
      objectives.push(directives.map((event) => event.payload.instruction).join("\n"));
      requiredToolNames.push(...directives.flatMap(
        (event) => inferDirectorToolNames(event.payload.instruction),
      ));
    }
    return {
      mode,
      objective: objectives.join("\n"),
      sourceEventIds: [...new Set([
        ...(plan?.sourceEventIds ?? []),
        ...events.map((event) => event.id),
        ...directives.map((event) => event.id),
      ])],
      requiredToolNames: [...new Set(requiredToolNames)],
    };
  }
}
