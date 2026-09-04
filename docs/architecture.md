---
title: 系统架构
description: 从静态世界定义到可恢复事件流，理解 ChatVerse 的核心运行时。
category: concepts
order: 2
---

# 系统架构

ChatVerse 把“故事如何发生”拆成四层：静态定义、世界运行时、智能体决策和可观察输出。这样既能让模型参与叙事，也能让每一步都被调试、回放和恢复。

## 四层模型

### WorldDefinition：静态蓝图

`WorldDefinition` 描述 World 的初始形状：元数据、Actor、Context、关系、叙事章节以及 Director Policy。它不包含 API Key，也不包含运行中产生的临时结果。

### World Runtime：状态与调度

`World` 是可运行的状态机。它负责生命周期、Context 激活、输入排队、任务取消、事件提交和 Snapshot。默认使用 `InProcessRuntimeHost`，也可以接入 World Server。

### Director + Actors：决定下一步

Director 负责宏观推进和剧情规划；Narrator 负责当前幕的场景整理、旁白与下一棒仲裁；Actor 只通过稳定 ID 关联 Context，不依赖显示名称。World 负责把这些控制器的结果串行提交为世界事件。

### Events / Snapshot：事实与恢复

所有已经提交的变化都会成为 `WorldEvent`。`WorldSnapshot` 保存事件、Actor 状态、Context 投影、内部队列、剧情图和 Director 游标，可以在另一个进程中恢复。

## 一次输入的路径

```text
玩家消息
  -> World.sendMessage()
  -> Context 输入队列
  -> Director 或 Narrator 调度
  -> Actor 生成回复 / Narrator 生成旁白
  -> 提交 WorldEvent
  -> Context 投影、订阅者和 Snapshot
```

## Context 为什么独立

Context 是一段隔离的对话或叙事视图。群聊、私聊、任务上下文可以共享同一份 Actor 状态，却拥有不同的消息历史和参与者集合。这样既能避免私聊泄露到群聊，也能让多个视图观察同一个世界。

## 可观测性边界

- `WorldEvent`：已经发生、可以用于重建投影的世界事实。
- `WorldNotification`：Director 调度、Actor wake、错误和 Token 使用等运行观察信息。
- `snapshot()`：在某个稳定时点保存可恢复状态，不保存 Provider 或 API Key。

## 设计原则

1. 稳定 ID 优先：Actor 和 Context 的关联不依赖名称。
2. 事实先提交：取消任务不会撤回已经提交的事件。
3. 运行时可替换：Provider、Runtime Host 和演出消费方式都是边界适配器；World 状态只由聚合根提交。
4. 观察与事实分离：诊断信息不会污染世界事件流。

## 当前模块所有权

- **Core**：`engine/world/world.ts` 是唯一的 World 聚合根，负责生命周期、串行提交和公共命令；Director、Narrator、Actor、演出队列、记忆、恢复、投影和持久化分别位于 `engine/world` 下的对应目录。`engine/session.ts` 是 Harness facade，队列、生命周期、压缩和 World 装配位于 `engine/session`。
- **Core 合同**：`contracts/world.ts` 保留一套按领域分段的公开 World 协议。它目前约 700 行，仍是同一公共合同，不为追求小文件而拆成互相转发的类型文件；运行时内部类型放在实际拥有状态的模块中。
- **World Server**：`server.ts` 负责应用装配和路由组合；HTTP 校验、响应、静态资源和房间守卫位于 `http`、`rooms`；创作预演、任务驱动、日志、SSE 和会话注册位于 `authoring`。
- **World Authoring**：`architect` 编排模型循环，`draft` 管理草稿操作与校验，`sources` 管理资料，`session` 保存创作会话日志与计划。
- **Frontend**：页面只负责路由和布局；World 的运行时、投影、演出消费和面板位于 `world`，Studio 的会话、草稿、日志、来源和 API 位于 `features/studio`，公共存储、API 和 UI 位于 `shared`。

模块只有在超过边界或同时拥有多个独立状态职责时才继续拆分。当前架构审计没有行数豁免；新模块不得通过重新引入跨层转发、重复 DTO 或隐式状态来降低单文件数字。

## 架构护栏

根目录执行 `npm run audit` 会检查生产源码的模块边界与维护成本：

- workspace 之间只能通过包公开入口导入，禁止引用另一个包的 `src`。
- 生产模块不能形成循环依赖。
- 普通生产文件最多 800 行，明确登记的聚合根最多 1500 行，React Page 最多 500 行。
- 所有生产模块必须能从对应 workspace 入口到达，非入口模块不应保留无调用导出。

审计配置只保留阈值和聚合根名单，不存放旧 Snapshot、旧模块或临时豁免。任何新增豁免都必须先证明无法通过职责归位解决，并在同一变更中安排清理。
