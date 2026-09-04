import { randomUUID } from "node:crypto";
import {
  AuthoringTaskDriver,
} from "../authoring-task-driver.js";
import {
  errorMessage,
  nextTaskItem,
  nextTaskPhase,
} from "../authoring/helpers.js";
import type {
  WorldArchitectResult,
  WorldAuthoringPlan,
  WorldAuthoringTask,
} from "@chatverse/world-authoring";

const DEFAULT_TASK_MAX_ROUNDS = 48;

export interface AuthoringTaskRuntimeHost {
  getPlan(): WorldAuthoringPlan | undefined;
  getTask(): WorldAuthoringTask | undefined;
  setTask(task: WorldAuthoringTask | undefined): void;
  getAcceptedRevision(): number;
  isSessionIdle(): boolean;
  assertIdle(): void;
  failConflict(message: string): never;
  now(): number;
  runPlanStage(title: string): Promise<WorldArchitectResult>;
  cancelOperation(): void;
  publishTask(task: WorldAuthoringTask | undefined): void;
  publishPlan(plan: WorldAuthoringPlan | undefined): void;
}

export type AuthoringTaskResumeResult = "started" | "needs_start";

/** Owns the long-running, staged authoring task and its retry-free driver. */
export class AuthoringTaskRuntime {
  private readonly driver: AuthoringTaskDriver;

  constructor(private readonly host: AuthoringTaskRuntimeHost) {
    this.driver = new AuthoringTaskDriver(
      () => this.drive(),
      (error) => this.handleDriverError(error),
    );
  }

  start(maxRounds?: number): void {
    this.host.assertIdle();
    const plan = this.host.getPlan();
    if (!plan || plan.items.length === 0) {
      this.host.failConflict("请先让创作助手建立一个创作计划，再启动长期创作任务。");
    }
    const resolvedMaxRounds = maxRounds ?? this.host.getTask()?.maxRounds ?? DEFAULT_TASK_MAX_ROUNDS;
    if (!Number.isSafeInteger(resolvedMaxRounds) || resolvedMaxRounds < 1 || resolvedMaxRounds > 128) {
      this.host.failConflict("长期创作任务的轮次必须是 1 到 128 之间的整数。");
    }
    const phase = nextTaskPhase(plan);
    if (!phase) {
      this.host.failConflict("当前创作计划已经完成，没有可继续的阶段。");
    }
    this.host.setTask({
      id: randomUUID(),
      objective: plan.goal,
      phase,
      status: "active",
      draftRevision: this.host.getAcceptedRevision(),
      roundsStarted: 0,
      maxRounds: resolvedMaxRounds,
      noOpStreak: 0,
      updatedAt: this.host.now(),
    });
    this.publishTask();
    this.driver.request();
  }

  pause(): void {
    const task = this.host.getTask();
    if (!task || task.status === "completed") return;
    task.status = "paused";
    task.updatedAt = this.host.now();
    task.lastError = undefined;
    this.driver.cancelPending();
    this.host.cancelOperation();
    this.publishTask();
  }

  resume(): AuthoringTaskResumeResult {
    this.host.assertIdle();
    const task = this.host.getTask();
    if (!task) return "needs_start";
    if (task.status === "completed") {
      this.host.failConflict("当前长期创作任务已经完成。");
    }
    const plan = this.host.getPlan();
    if (!plan || !nextTaskPhase(plan)) {
      task.status = "completed";
      task.updatedAt = this.host.now();
      this.publishTask();
      return "started";
    }
    if (task.roundsStarted >= task.maxRounds) {
      this.host.failConflict("长期创作任务已达到轮次上限，请新建任务或提高轮次上限。");
    }
    task.status = "active";
    task.lastError = undefined;
    task.updatedAt = this.host.now();
    this.publishTask();
    this.driver.request();
    return "started";
  }

  cancelPending(): void {
    this.driver.cancelPending();
  }

  close(): void {
    this.driver.close();
  }

  private publishTask(): void {
    this.host.publishTask(this.host.getTask());
  }

  private handleDriverError(error: unknown): void {
    const task = this.host.getTask();
    if (!task || task.status !== "active") return;
    task.status = "blocked";
    task.lastError = errorMessage(error);
    task.updatedAt = this.host.now();
    this.publishTask();
  }

  private async drive(): Promise<void> {
    const task = this.host.getTask();
    if (!task || task.status !== "active" || !this.host.isSessionIdle()) return;
    const plan = this.host.getPlan();
    const item = plan && nextTaskItem(plan);
    if (!item) {
      task.status = "completed";
      task.updatedAt = this.host.now();
      this.publishTask();
      return;
    }
    if (item.status === "pending") {
      item.status = "in_progress";
      this.host.publishPlan(plan);
    }
    if (task.roundsStarted >= task.maxRounds) {
      task.status = "blocked";
      task.lastError = `已达到 ${task.maxRounds} 轮任务上限。`;
      task.updatedAt = this.host.now();
      this.publishTask();
      return;
    }
    task.phase = item.scope;
    task.roundsStarted += 1;
    task.updatedAt = this.host.now();
    this.publishTask();
    try {
      const result = await this.host.runPlanStage(item.title);
      const current = this.host.getTask();
      if (!current || current.status !== "active") return;
      current.draftRevision = this.host.getAcceptedRevision();
      current.updatedAt = this.host.now();
      if (result.changeSet) {
        current.status = "active";
        current.noOpStreak = 0;
        const nextItem = this.host.getPlan() && nextTaskItem(this.host.getPlan()!);
        if (!nextItem) {
          current.status = "completed";
          current.lastError = undefined;
        } else {
          if (nextItem.status === "pending") nextItem.status = "in_progress";
          current.phase = nextItem.scope;
          current.lastError = undefined;
          this.host.publishPlan(this.host.getPlan());
          this.driver.request();
        }
        this.publishTask();
        return;
      }
      current.noOpStreak += 1;
      if (!this.host.getPlan() || !nextTaskPhase(this.host.getPlan()!)) {
        current.status = "completed";
        current.lastError = undefined;
      } else {
        current.status = "waiting_user";
        current.lastError = "本阶段没有形成新的修改。请用自然语言补充方向，任务会从当前草稿继续。";
      }
      this.publishTask();
    } catch (error) {
      const current = this.host.getTask();
      if (!current || current.status === "paused") return;
      current.status = "blocked";
      current.lastError = errorMessage(error);
      current.updatedAt = this.host.now();
      this.publishTask();
    }
  }
}
