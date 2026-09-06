<p align="center">
  <img src="docs/assets/readme/chatverse-ai-world.png" alt="ChatVerse - 实时生成、自由参与的 AI 世界" width="100%" />
</p>

<h1 align="center">ChatVerse</h1>

<p align="center">
  <strong>让一群拥有身份、记忆与关系的 AI 角色，生活在同一个持续运转的世界里。</strong>
</p>

<p align="center">
  <a href="https://world.chatverse.fun">在线体验</a> ·
  <a href="https://github.com/MengPaul07/ChatVerse-OpenSource">GitHub 开源仓库</a> ·
  <a href="docs/product-doc.md">产品文档</a> ·
  <a href="docs/API.md">Core API</a> ·
  <a href="docs/world-benchmark.md">WorldBench</a>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-2f6f62" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-43853d" />
  <img alt="BYOK" src="https://img.shields.io/badge/model-BYOK-b45f3b" />
</p>

ChatVerse 是一个事件驱动的可运行世界创作与编排工具。你可以从一句设定、资料文档或模板建立 World；Director 负责长期剧情与章节，Narrator 维护当前场景并选择下一位参与者，Actor 与玩家则依据各自身份、认知、关系和记忆完成演出。

它既可以像实时群聊一样自然流动，也可以切换为需要玩家逐句推进的视觉小说舞台。两种界面读取的是同一个 World、同一条事件时间线和同一份角色记忆。

- **事件驱动核心**：`@chatverse/core` 使用纯 TypeScript，实现 World、调度、上下文隔离、演出队列、恢复和长期记忆。
- **玩家真正参与**：玩家 Actor 与 AI Actor 使用同一套唤醒语义；可以选择提案、自由输入、自动代演或旁观。
- **长程世界创作**：Studio 支持多文档世界书、Markdown 资料、联网考据、章节规划、预演与版本历史。
- **本地优先**：作品与视觉素材保存在浏览器 IndexedDB；模型连接采用 BYOK，服务端不持久化作品和 API Key。

<p align="center">
  <img src="docs/assets/readme/galgame-stage-live.png" alt="ChatVerse Galgame 舞台演出实机画面" width="100%" />
</p>

<p align="center">
  <img src="docs/assets/readme/world-page-live.png" alt="ChatVerse 普通世界页实机画面" width="100%" />
</p>

<p align="center"><sub>实机演出：同一个世界既可以连续阅读，也可以进入 Galgame 舞台逐棒参与。</sub></p>

## 核心体验

### 创作世界

- 从**一句设定**或 **7 个模板卡包**开始：五行山、海棠诗社、赤壁议战、樱丘高校、夜班档案室、模拟法庭、索尔维会议。
- **World Studio**：创作助手（World Architect）与手动编辑操作同一份 WorldDraft，共用校验、预演、版本历史、撤销与重做。
- **联网考据（可选）**：创作助手可调用联网搜索核对历史、公版原著与现实设定，并保留引用来源。搜索只服务于创作阶段，运行时角色不会“上网”。

### 运行世界

- **World Director** 规划 Chapter 与 Beat，管理宏观剧情、参与者范围和世界状态，不代写角色台词。
- **Narrator** 维护 `sceneNow`、输出必要旁白并选择下一位 Actor 或玩家；**Actor** 依据各自身份、认知与关系自主说话和行动。
- 玩家可以发消息、@ 角色、请求剧情推进，或向 Director 提交宏观指令。
- 群聊与私聊是 World 内彼此隔离的 Context：共享角色身份与记忆，不共享聊天记录，也不污染主世界叙事。

### Galgame 舞台演出

每个世界都可以切换为视觉小说式的舞台演出：

- **逐棒演出**：Narrator → 角色 / 玩家持续推进；每条信息逐句确认（空格键推进），后台预取减少模型等待。
- **玩家提案**：到玩家回合时，系统根据玩家角色卡生成 2–4 个明显不同的合理选项与一个自动代演选项；也可以自由输入。
- **视觉呈现**：按当前幕自动生成横向背景与角色立绘（支持 6 家图像服务，可上传自定义立绘）。
- **自动代演**：开启后玩家回合由提案自动提交，适合全程旁观。

## 社区

- 线上前端：<https://world.chatverse.fun>（首次使用请在设置中配置自己的模型连接）
- QQ 群：`608677461`
- GitHub：<https://github.com/MengPaul07/ChatVerse-OpenSource>

## 运行模型

```text
资料 / 玩家输入 / 世界事件
              |
              v
       World Director
      Chapter → Beat
              |
              v
          Narrator
 sceneNow / 旁白 / 选择参与者
              |
              v
        Actor / Player
          表达与行动
              |
              v
       WorldEvent Journal
              |
      +-------+-------+
      |               |
 Context 投影    Presentation Queue
      |               |
      +-------+-------+
              |
       世界页 / 演出页
```

- World 是唯一产品级运行入口。
- 世界页与演出页共享同一个 Narrator Runtime；区别只在前端消费演出队列的节奏。
- Group 通过 `worldDefinitionFromGroup()` 编译为单 Context World。

## 模型连接

ChatVerse 使用协议驱动的用户自带模型连接：OpenAI Chat Completions 兼容服务共用一个驱动，OpenAI Responses 用于需要该协议的能力，Anthropic 使用官方 Messages SDK。在“设置 → 模型与密钥”中配置；配置只随请求发送到服务端，不写入 World、Group 包、存档或调试轨迹。

- **默认推荐 DeepSeek**：设置页内置预设，导演 / 角色 / 创作助手可分别指定模型。
- **联网创作模型（可选）**：需使用支持 Responses API 内置搜索的模型，通过 `AUTHORING_RESEARCH_MODEL` 或 `RESEARCH_MODEL` 配置；Anthropic Messages 首期不开放联网创作。

## 本地开发

要求 Node.js 20 或更高版本。

```bash
npm install
cp apps/world-server/.env.example apps/world-server/.env
npm run dev:world
```

- 前端：<http://127.0.0.1:5173>
- World Server：<http://127.0.0.1:8787>

`apps/world-server/.env` 中的服务端默认配置（均可选，浏览器配置优先）：

```dotenv
# 通用协议配置（优先级高于下面的旧环境变量别名）
CHATVERSE_PROVIDER_PROTOCOL=openai-chat
CHATVERSE_PROVIDER_NAME=
CHATVERSE_API_KEY=
CHATVERSE_BASE_URL=
CHATVERSE_MODEL=
CHATVERSE_PROVIDER_OPTIONS_JSON={}
# OpenAI-compatible Chat Completions 服务
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=
# DeepSeek 仍使用 OpenAI Chat/Responses 协议驱动
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=
# Anthropic Messages
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=
# 按角色拆分模型（省略时回退到默认模型）
DIRECTOR_MODEL=
CHARACTER_MODEL=
AUTHORING_MODEL=
# 联网创作模型（需要 Responses API 内置搜索）
AUTHORING_RESEARCH_MODEL=
RESEARCH_MODEL=
# 世界诊断开关
CHATVERSE_DEBUG=false
```

## 验证与质量

```bash
npm run typecheck   # 全部 workspace 类型检查
npm test            # 单元测试 + 预算测试
npm run build       # 全部 workspace 构建
npm start           # 生产模式:World Server 托管 frontend/dist
```

真实模型长程验收（需要已配置模型连接）：

```bash
# CVWB 确定性契约与发布预算测试(不消耗额度)
npm run cvwb:test

# CVWB 真实 Provider 世界场景(默认加载 apps/world-server/.env)
npm run cvwb:live -- --profile=world --scenario=cvwb-001

# CVWB 真实 Provider Studio 创作场景
npm run cvwb:live -- --profile=studio

# CVWB 发布级链路验收：HTTP/SSE 与 Galgame
npm run cvwb:e2e:server
npm run cvwb:e2e:galgame
```

质量记录见 `docs/`：

- [产品文档](docs/product-doc.md) — 产品边界与质量标准
- [API](docs/API.md) — `@chatverse/core` 公开接口
- [Prompt 调优记录](docs/PROMPT_TUNING_LOG.md) — 真实 Provider 基线、改动与复测
- [World Server 真实链路验收](docs/world-server-live-e2e.md)
- [ChatVerse WorldBench(CVWB)基准](docs/world-benchmark.md) — 引擎无关的结果导向基准、场景与评分
- [World Source](docs/world-source.md) — 多章节资料、中文检索与 Director 渐进读取
- [自托管部署](deploy/README.md) — 通用构建说明、systemd 与 Nginx 示例

## Core 示例

```ts
import {
  ChatVerse,
  createOpenAIChatProvider,
  worldDefinitionFromGroup,
} from "@chatverse/core";

const provider = createOpenAIChatProvider({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL,
  model: process.env.DEEPSEEK_MODEL,
});

const chatverse = new ChatVerse({ provider });
const world = chatverse.createWorld(worldDefinitionFromGroup(groupCard));

world.onEvent((event) => {
  console.log(event.sequence, event.type, event.payload);
});

world.start();
world.sendMessage({
  contextId: "context:main",
  actorId: "actor:player",
  message: "@孙悟空 山顶的法帖有变化。",
});
```

完整公共接口见 [docs/API.md](docs/API.md)。

## 项目结构

```text
ChatVerse/
├── packages/core/             # World、Director/Narrator/Actor、演出队列、记忆与 Provider
├── packages/world-authoring/  # WorldDraft、World Architect、联网考据、校验和编译
├── packages/world-source/     # Markdown/TXT 编译、稳定分块、BM25 与 Source Provider
├── packages/group-package/    # 可分享 Group ZIP 编解码
├── packages/world-run-lab/    # ChatVerse 的 CVWB 执行适配器与轨迹投影
├── packages/world-benchmark/   # CVWB:场景、断言、评分、预算与统一测试入口
├── apps/world-server/         # 内存房间、HTTP API、SSE、图像生成与静态托管
├── frontend/                  # Studio、世界运行、Galgame 舞台、设置与 Debug UI
└── docs/                      # 产品、API 与质量文档
```

## 数据边界

- Core 不依赖 UI、数据库或文件系统。
- WorldDefinition 是编译后的内存协议，不限定源数据来自 JSON、Markdown 或数据库。
- 浏览器 IndexedDB 是用户作品的持久化来源；服务端房间是临时运行实例。
- 分享包（`.chatverse.zip`）不包含聊天历史、API Key、调试轨迹或运行时密钥。
- 当前不包含登录、在线社区、多人共享房间、云存档、付费或订阅系统。

## 开源协议

ChatVerse 源码采用 [GNU Affero General Public License v3.0](LICENSE)。你可以使用、研究、修改和分发本项目；如果修改后的版本通过网络向用户提供服务，也需要向这些用户提供对应源码。

`packages/world-benchmark` 中的评测场景与评分材料另受其 [WorldBench Evaluation License](packages/world-benchmark/BENCHMARK_LICENSE.md) 约束。
