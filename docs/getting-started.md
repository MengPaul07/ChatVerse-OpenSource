---
title: 5 分钟上手 ChatVerse
description: 从 Provider、WorldDefinition 到第一条事件，跑通一个最小的世界运行时。
category: start
order: 1
---

# 5 分钟上手 ChatVerse

这条路径只做一件事：创建一个最小 World，发送一条消息，然后观察已经提交的世界事件。

## 安装

在仓库根目录安装依赖：

```bash
npm install
```

构建所有 workspace：

```bash
npm run build
```

## 创建 Provider

ChatVerse 默认使用 OpenAI Chat Completions 协议。OpenAI-compatible 服务共用一个驱动；如果连接使用 Responses 或 Anthropic Messages，则在对应协议驱动中配置。Provider 只负责模型调用，世界状态仍由 Runtime 管理：

```ts
import {
  ChatVerse,
  createOpenAIChatProvider,
} from "@chatverse/core";

const provider = createOpenAIChatProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
});

const chatverse = new ChatVerse({
  directorProvider: provider,
  characterProvider: provider,
});
```

Anthropic 连接使用同一套运行时接口，只需替换 Provider：

```ts
import { createAnthropicMessagesProvider } from "@chatverse/core";

const anthropic = createAnthropicMessagesProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  baseURL: "https://api.anthropic.com",
  model: "claude-sonnet-4-20250514",
});
```

## 定义一个 World

WorldDefinition 描述静态蓝图：有哪些 Actor、哪些 Context，以及导演可以使用的规则。

```ts
const world = chatverse.createWorld({
  metadata: {
    id: "world:demo",
    name: "山顶茶馆",
    description: "三个角色在风暴前交换情报。",
  },
  actors: [
    {
      id: "actor:player",
      kind: "character",
      playerControlled: true,
      card: {
        name: "旅人",
        description: "刚抵达山顶的旅人。",
        personality: "谨慎，愿意追问。",
        scenario: "站在茶馆前厅。",
        messageExample: "先告诉我发生了什么。",
      },
    },
    {
      id: "actor:guide",
      kind: "character",
      card: {
        name: "引路人",
        description: "熟悉山路的引路人。",
        personality: "沉着，观察细致。",
        scenario: "正在茶馆前厅等候。",
        messageExample: "风向变了，我们得快些。",
      },
    },
  ],
  contexts: [
    { id: "context:main", name: "茶馆前厅", actorIds: ["actor:player", "actor:guide"] },
  ],
});
```

## 启动、输入和观察

```ts
world.start();

world.onEvent((event) => {
  console.log(event.sequence, event.type, event.payload);
});

world.sendMessage({
  contextId: "context:main",
  actorId: "actor:player",
  message: "山顶的风为什么突然停了？",
});
```

`WorldEvent` 是已经提交的世界事实。诊断通知、Director 调度和 Token 使用等运行观察信息会通过 `onNotification()` 发送。

## 接下来读什么

- 先读 [系统架构](./architecture.md)，理解 World、Context 和事件流的关系。
- 再读 [API 参考](./API.md)，查找完整的生命周期、Snapshot 和 Group 接口。
- 最后运行前端的 Debug 页面，观察一次输入如何经过 Runtime 变成事件。
