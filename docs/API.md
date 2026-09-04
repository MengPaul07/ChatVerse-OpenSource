---
title: ChatVerse API
description: Core World、Context、Actor、事件、快照与创作能力的公开 API。
category: reference
order: 10
---

# ChatVerse API

本文只描述当前公开 API。Core 的 Session、队列、Harness Driver、Context Builder 和 Director Agent 都是内部实现，不属于稳定入口。

## 安装与导入

```ts
import {
  ChatVerse,
  createOpenAIChatProvider,
  createOpenAIResponsesProvider,
  createAnthropicMessagesProvider,
  worldDefinitionFromGroup,
} from "@chatverse/core";
```

`@chatverse/core` 只提供根入口，不提供子路径导入。

## Provider

```ts
const provider = createOpenAIChatProvider({
  apiKey: "...",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  timeoutMs: 30_000,
  maxRetries: 0,
});
```

`createOpenAIChatProvider()` 可连接实现 OpenAI Chat Completions 协议的服务。`baseURL` 与 `model` 应以服务商实际配置为准。需要 Responses 协议时使用 `createOpenAIResponsesProvider()`；Anthropic 连接使用 `createAnthropicMessagesProvider()`。

可使用同一 Provider，也可以分配不同模型：

```ts
const chatverse = new ChatVerse({
  directorProvider,
  characterProvider,
  runtime,
});
```

`runtime` 可省略，默认使用 `InProcessRuntimeHost`。

### 联网研究 Provider（可选）

`createOpenAIResponsesResearchProvider()` 创建一个 `WebResearchProvider`，供创作助手（World Architect）调用。它通过 OpenAI-compatible Responses API 的内置 `web_search` 工具执行服务端搜索：

```ts
import { createOpenAIResponsesResearchProvider } from "@chatverse/core";

const research = createOpenAIResponsesResearchProvider({
  apiKey,
  baseURL: "https://api.openai.com/v1",
  model: "gpt-5-mini",
});
```

搜索结果带来源 URL 与标题。该 Provider 只服务创作阶段的考据，World 运行时（Director / Narrator / Actor）不使用它。

## 创建 World

```ts
const world = chatverse.createWorld(definition, {
  debug: true,
});
```

`CreateWorldOptions` 支持 `snapshot`（冷恢复）、`directorPolicy`、`actorMemoryPolicy` 与 `debug`。

`WorldDefinition` 的核心结构：

```ts
interface WorldDefinition {
  metadata: WorldMetadata;
  lore?: LoreBook;
  actors: WorldActorDefinition[];
  contexts: WorldContextDefinition[];
  relations?: WorldRelation[];
  chapters?: NarrativeChapter[];
  directorPolicy?: WorldDirectorPolicy;
  actorMemoryPolicy?: WorldActorMemoryPolicy;
}
```

Actor 和 Context 使用稳定 ID 关联，名称只用于显示。

## 生命周期

```ts
world.start();
world.pause();
world.resume();
world.stop();
```

- `start()` 启动 World 与可运行 Context。
- `pause()` 暂停调度并保留已提交状态。
- `resume()` 恢复调度。
- `stop()` 终止运行并丢弃停止后才完成的模型结果。

## 输入与推进

玩家消息：

```ts
world.sendMessage({
  contextId: "context:main",
  actorId: "actor:player",
  message: "你们听见山顶的声音了吗？",
});
```

外部世界事实：

```ts
world.emitEvent({
  message: "山顶法帖出现裂纹。",
  contextIds: ["context:main"],
  actorIds: ["actor:wukong"],
});
```

导演指令：

```ts
world.intervene({
  instruction: "推进到师徒双方必须作出选择的时刻。",
});
```

请求一次剧情检查：

```ts
world.requestProgression({
  contextId: "context:main",
  reason: "observer_continue",
});
```

`requestProgression()` 只触发 Director 检查，不保证一定产生旁白或剧情节点。

## Galgame 舞台演出

在 `WorldContextDefinition` 上声明 `presentation` 即可让该 Context 以视觉小说舞台方式演出：

```ts
presentation: {
  kind: "galgame",
  playerActorId: "actor:player",
  artDirection: "东方古典神话视觉小说，工笔质感与电影光影结合",
  backgroundGeneration: "auto",
  acknowledgement: "required",
}
```

舞台模式由 Narrator 统一仲裁旁白、角色和玩家的逐棒演出。玩家回合的输入方法：

```ts
// 从提案选项中提交一个表演
world.submitPlayerTurn({
  contextId: "context:main",
  actorId: "actor:player",
  proposalId: proposal.id,
  performance: { message: "先问清五百年的缘由再作决定。" },
});

// 逐棒确认（acknowledgement: "required" 时，等玩家确认后再推下一棒）
world.acknowledgePresentation({
  contextId: "context:main",
  turnToken,
});

// 更新玩家角色卡（影响后续提案与边界约束）
world.updatePlayerCard({
  actorId: "actor:player",
  card: { name: "旅人", identity: "...", /* ... */ },
});
```

## Context 管理

```ts
world.activateContext("context:main");
world.suspendContext("context:main");

const privateChat = world.createChatContext({
  humanActorId: "actor:player",
  actorIds: ["actor:wukong"],
  conversationMode: "private",
  name: "与孙悟空私聊",
});
```

群聊和私聊共享 World Actor 状态，但消息历史彼此隔离。

动态注册 Actor：

```ts
world.registerActor({
  actor,
  relations: [],
});
```

Director 生成的临时场景角色也通过相同的 World Actor 投影出现。

## Actor 记忆

World 内每个 Actor 拥有独立工作记忆，背景整理（Memory Curator）异步把观察提炼为记忆节点：

```ts
world.recordActorMemory({
  actorId: "actor:wukong",
  content: "唐僧尚未揭帖，但已答应先问明缘由。",
});

world.reviseActorMemory({
  actorId: "actor:wukong",
  nodeId,
  content: "唐僧已确认三更东南风起，明日动手揭帖。",
});
```

记忆提交按 Actor 隔离，角色只能读到自己的记忆与公开世界事实。

## 订阅输出

```ts
const unsubscribeEvent = world.onEvent((event) => {
  console.log(event.sequence, event.type, event.payload);
});

const unsubscribeNotification = world.onNotification((notification) => {
  console.log(notification.sequence, notification.type, notification.payload);
});
```

- `WorldEvent` 是已提交的世界事实，可用于重建投影。
- `WorldNotification` 是运行观察信息，例如 Director 调度、Actor wake、错误和 Token 使用。
- silent、generating、idle 等诊断状态不会进入世界事实流。
- 订阅者异常相互隔离。

读取 Context 消息：

```ts
const messages = world.getContextMessages("context:main");
```

## Debug 与 Token 用量

```ts
const world = chatverse.createWorld(definition, {
  debug: { enabled: true, tracePrompts: true, traceToolCalls: true },
});

world.onDebug((event) => {
  console.log(event.category, event.type, event.payload);
});

const debug = world.debugSnapshot(); // 含事件、Token 用量与记忆快照
```

`WorldDebugSnapshot` 提供按 `world` / `director` / `narrator` / `actor` 等分类的事件流，以及 `tokenUsage` 总账与按 turn 的用量明细。Debug 事件不进入 World 事实流，也不写入 Snapshot。

## Snapshot 与 Archive

```ts
const snapshot = world.snapshot();
const restored = chatverse.createWorld(definition, { snapshot });
```

`WorldSnapshot` 当前只接受 `schemaVersion: 7`。它保存已提交事件、Actor 状态、Context 投影、内部队列、剧情图、Presentation 运行时与 Director 游标，不保存 Provider、API Key 或源文件。

`WorldArchive` 在 Snapshot 外附带 WorldDefinition 与展示元数据（封面、最后场景、活跃剧情章节），供浏览器本地存档和恢复。

## World Source

长篇资料由独立包编译，并通过不可变绑定交给 World：

```ts
import {
  InMemoryWorldSourceProvider,
  compileWorldSourceBundle,
} from "@chatverse/world-source";

const bundle = compileWorldSourceBundle({
  id: "source:novel",
  revision: 1,
  name: "原作资料",
  documents: [{ path: "volume-1.md", content: markdown }],
});

definition.sources = [{
  bundleId: bundle.id,
  revision: bundle.revision,
  fidelity: "reference",
}];

const world = chatverse.createWorld(definition, {
  sourceProvider: new InMemoryWorldSourceProvider({ bundles: [bundle] }),
});
```

Director 先查看目录或搜索，再读取少量正文块，最后规划带 `sourceBasis` 的 Beat。Actor 与 Narrator 不会接收 Source 正文。详见 [world-source.md](world-source.md)。

## Group

GroupCard 是单一聊天 Context 的可分享配置：

```ts
const group = defineGroupCard({
  metadata,
  scene,
  characters,
  userProfiles,
  relations,
  runtime,
});

const definition = worldDefinitionFromGroup(group);
```

反向导出：

```ts
const group = groupCardFromWorldDefinition(definition, options);
```

Group 运行时仍通过 World，不存在独立公开 Session 模式。

## Runtime Host

Core 提供：

- `InProcessRuntimeHost`：Node 与浏览器默认实现。
- `ManualRuntimeHost`：使用手动时钟和调度器进行确定性测试。
- `InMemoryRuntimeNotificationBus`：进程内观察通知总线。

`RuntimeHost` 提供 `clock`、`scheduler`、`idGenerator` 与观察型 `notifications`。业务输入仍通过 World 的明确方法进入。

## World Authoring

创作能力位于独立包：

```ts
import {
  WorldArchitect,
  compileGroupCardFromWorldDraft,
  compileWorldDraft,
  createEmptyWorldDraft,
  validateWorldDraft,
} from "@chatverse/world-authoring";
```

`WorldDraft` 是可编辑作品；`WorldDefinition` 和 `GroupCard` 是确定性编译产物。Architect 只修改临时工作副本，用户接受 ChangeSet 后才保存。

Architect 支持可选联网考据与分阶段创作计划：

```ts
const architect = new WorldArchitect(provider, {
  researchProvider,      // WebResearchProvider；省略时纯离线创作
  researchEnabled: true, // 每轮最多 3 次联网调用
  onResearchEvent: (event) => {
    // started / completed / failed，completed 带来源列表
  },
});
```

## Group Package

```ts
import {
  createGroupPackageArchive,
  decodeGroupPackageArchive,
} from "@chatverse/group-package";
```

`.chatverse.zip` 包含唯一语义文件 `group.json` 与可选 `assets/`，不包含历史、Snapshot、API Key 或设备配置。

## WorldBench(CVWB)

引擎无关的结果导向基准集位于独立包：

```ts
import {
  createWorldBenchV1Scenarios,
  runBenchmarkScenario,
  runBenchmarkSuite,
} from "@chatverse/world-benchmark";
import {
  createChatVerseWorldBenchAdapter,
  createChatVerseStudioBenchAdapter,
} from "@chatverse/world-run-lab";

const adapter = createChatVerseWorldBenchAdapter({ providers });
const report = await runBenchmarkSuite(
  adapter,
  createWorldBenchV1Scenarios(),
  { repeats: 3 },
);
```

- `BenchmarkScenario` 只规定 fixture、actions 与评分标准；引擎通过 `BenchmarkEngineAdapter` 把运行轨迹投影为 `BenchmarkObservation`，评分器不接触引擎内部。
- `scoreScenario()` / `scoreSuite()` 组合确定性断言、运行指标与可选盲评 Judge 分数；缺失 Judge 时报告显示 `needs_judge`。
- Studio 场景（`cvwb-studio-001-research-to-world`）通过 `runStudioBenchmarkScenario()` 与 `createChatVerseStudioBenchAdapter` 运行。
- `createCVWBSuiteRegistry()` 是世界、Studio 与发布预算场景的统一目录；确定性契约和预算测试统一由 `npm run cvwb:test` 执行。

完整场景清单与运行方式见 [world-benchmark.md](world-benchmark.md)。场景定义与评分标准受 [BENCHMARK_LICENSE.md](../packages/world-benchmark/BENCHMARK_LICENSE.md) 约束。
