---
title: World Server 真实链路验收
description: 从健康检查到输入、事件流和恢复，验收 World Server 的真实运行链路。
category: reference
order: 11
---

# World Server 真实链路验收

## 目的

这套验收不是 Provider mock，也不是 Core 内存快照测试。它启动编译后的
`apps/world-server`，从该应用自己的工作目录读取 `.env`，通过真实 HTTP 和
SSE 操作一个临时世界，并使用真实的 Director、Narrator、Actor 和 Provider。

它模拟的是用户实际会走的最小生命周期：

1. 创建一个世界。
2. 建立 SSE 订阅。
3. 启动世界并等待开场剧情。
4. 以玩家身份发消息。
5. 请求一次继续观察。
6. 用 `Last-Event-ID` 重放已缓存事件。
7. 暂停、恢复并停止世界。

脚本不传请求级 API Key，不注入 `ManualClock`、固定 Provider 或理想化调度器。
它只验证服务端配置是否真的能驱动完整运行链路。

## 运行

确保 `apps/world-server/.env` 已配置一组真实的 OpenAI-compatible Provider：

```text
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=...
```

或者使用 DeepSeek 配置：

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DIRECTOR_MODEL=...
CHARACTER_MODEL=...
```

运行：

```bash
npm run world:e2e
```

可用环境变量：

- `WORLD_E2E_TIMEOUT_MS`：单阶段真实等待上限，默认 `180000`。
- `WORLD_E2E_ARTIFACT_DIR`：脱敏运行产物目录，默认 `.artifacts/world-server-e2e`。
- `WORLD_E2E_MAX_CALLS`：Provider 调用总预算，默认 `18`。
- `WORLD_E2E_MAX_TOKENS`：Token 总预算，默认 `50000`。
- `WORLD_E2E_MIN_CACHE_HIT_RATE`：缓存命中率下限，默认 `0.85`。
- `WORLD_E2E_MAX_BOOTSTRAP_DIRECTOR_CALLS`：开场 Director 调用上限，默认 `1`。
- `WORLD_E2E_MAX_PLAYER_ACTOR_CALLS`：玩家消息阶段 Actor 调用上限，默认 `3`。
- `WORLD_E2E_MAX_AMBIENT_TRIGGERS`：验收期间 Ambient 触发上限，默认 `0`。

## 通过条件

- 服务端 `/healthz` 报告自身 Provider 已配置。
- 创建、启动、玩家消息、继续观察、暂停、恢复、停止全部成功。
- SSE 主流的 `streamSequence` 严格递增。
- `Last-Event-ID: 0` 能重放缓存事件。
- 至少出现开场旁白、玩家消息、Director started/completed 和真实 Provider 用量记录。
- 没有 `*.error` 运行通知。
- HTTP 响应和运行产物不包含 API Key 字段。
- Provider 调用、Token、缓存命中、开场 Director、玩家阶段 Actor 与 Ambient
  均未超过发布预算。

报告按 `bootstrap`、`player-message`、`observer-progression` 和
`lifecycle-controls` 四个阶段统计耗时、调用量、Token、缓存命中率、模型与
Agent 角色分布。阶段以用户可观察的语义结果为边界，不要求持续运行的 World
彻底清空后台队列；跨边界完成的请求按其 SSE 用量事件实际到达的阶段计入。
任何硬预算失败都会使命令以非零状态退出。

脚本会把一次运行的事件摘要写入 `.artifacts/world-server-e2e/`。产物用于分析
真实调用量、事件类型和缓存行为，不作为业务存档，也不会被部署。

## Galgame 舞台演出验收

另一套验收（`scripts/galgame-live-e2e.mjs`）覆盖舞台演出链路：它同样启动编译后的
`apps/world-server`，用真实 Provider 创建一个带 `presentation.kind=galgame` 的世界，
并通过 SSE 观察逐棒接力演出。

流程：创建世界 → 订阅 SSE → 启动 → 旁白开场 → 角色回合 → 玩家提案回合（自动代演提交）→
逐棒确认（ACK）→ 暂停、恢复、停止。

运行：

```bash
npm run world:galgame:e2e
```

可用环境变量：

- `GALGAME_E2E_TIMEOUT_MS`：单阶段真实等待上限，默认 `240000`。
- `GALGAME_E2E_HOLD_MS`：ACK 后到下一棒的时间间隔，默认 `1500`。
- `GALGAME_E2E_TURNS`：目标可见演出棒数，默认 `12`。

通过条件：

- 出现旁白、角色与玩家回合，玩家提案回合被真实消费。
- ACK 等待期内没有模型调用（确认后不产生隐藏费用）。
- 没有 `*.error` 运行通知，存在真实 Provider 用量记录。
- 无图像服务配置时，图像生成接口返回明确的 400 配置错误（回退路径可验证）。
- 演出期间每次 hold 均产生可见内容。

产物写入 `.artifacts/galgame-live-e2e/`，包含逐棒 `turns` 明细（参与者、token、
entryIds、ACK 期调用数）、世界视图与用量统计。

## 与普通测试的边界

`npm test` 不执行此命令，因为真实 Provider 测试会消耗额度、受网络和模型响应
影响。提交前的常规回归仍使用普通 Core、Server、Frontend 测试；发布候选版本
必须额外执行一次本验收并保留产物。
