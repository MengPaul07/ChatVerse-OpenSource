---
title: ChatVerse WorldBench（CVWB）
description: 用结果导向场景验证世界运行时、Studio 和发布预算。
category: reference
order: 12
---

# ChatVerse WorldBench(CVWB)

ChatVerse WorldBench(简称 CVWB)是面向**语言驱动世界运行时**的结果导向基准测试集。它只规定输入与可观察结果,测试目标、状态变化、工具副作用、稳定性与成本,**不要求被测引擎使用 Narrator、Director 或某一种特定调度结构**。

引擎通过 `BenchmarkEngineAdapter` 接入:适配器把引擎的运行轨迹投影为标准的观察结果(`BenchmarkObservation`),评分器只消费投影,不接触引擎内部。

## 场景

第一版包含五个世界场景和一个 Studio 创作场景:

| 场景 ID | 名称 | 验证目标 | 预算 |
| --- | --- | --- | --- |
| `cvwb-001-absent-witness` | 东路目击者 | 玩家要求不在场的目击者出现,引擎必须升级为宏观支援并引入临时角色,而不是让现有角色反复猜测 | 12 次调用 / 70k token |
| `cvwb-002-contradictory-evidence` | 矛盾证据 | 矛盾命令与事实修正,验证知识边界与权限边界 | 28 次调用 / 90k token |
| `cvwb-003-crowd-relevance` | 十二人会议 | 相关性调度与反轮询:多角色场景只回应相关者 | 22 次调用 / 75k token |
| `cvwb-004-recovery-and-continuity` | 恢复与连续 | 故障、暂停与恢复后不重复提交、不丢事实 | 18 次调用 / 65k token |
| `cvwb-005-transition-beat-spawn` | 幕间生成 | 规划新幕时创建临时角色,验证 spawn、Beat 与实际演出的完整落地链 | 10 次调用 / 45k token |
| `cvwb-studio-001-research-to-world` | 联网创作 | 从空白草稿联网检索,并在同一次 Agent loop 中形成角色、玩家、场景与剧情线 ChangeSet | — |

场景输入是稳定的语义协议:fixture(世界、角色、Context、初始事实)+ actions(启动、玩家消息、导演指令、世界事件、时间推进、暂停/恢复、快照/恢复、Provider 故障注入、等待)。

## 评分

每个场景由三部分共同评分:

- **确定性断言**:事件顺序、角色生命周期(加入/离场/发言)、工具调用结果与预算;每项带权重,部分断言是硬门槛(hard gate)。
- **运行指标**:Provider 调用数、Token 总量、缓存命中率、卡死次数、墙钟时间。
- **盲评 Judge**:重复、清晰度、因果连续性和玩家意图响应。**没有 Judge 分数时,报告明确显示 `needs_judge`,不会把缺失评分伪装成通过。**

严重失败(崩溃、永久卡死、状态损坏、关键权限或事实泄漏)会把该场景最高分限制为 **39 分**。

## 适配器

`@chatverse/world-run-lab` 提供 ChatVerse 的第一个适配器:

```ts
import { runBenchmarkSuite } from "@chatverse/world-benchmark";
import {
  createChatVerseWorldBenchAdapter,
  createChatVerseStudioBenchAdapter,
} from "@chatverse/world-run-lab";

const adapter = createChatVerseWorldBenchAdapter({ providers });
const report = await runBenchmarkSuite(adapter, createWorldBenchV1Scenarios(), {
  repeats: 3,
});
console.log(report.result.aggregate);
```

ChatVerse 适配器已覆盖普通消息、世界事件、导演指令、暂停/恢复、快照与恢复;故障注入与世界时钟动作会**明确报告为未支持**,不会静默跳过。

## 运行方式

### 统一确定性测试(不消耗额度)

```bash
npm run cvwb:test
```

该入口包含 CVWB 场景/评分契约测试和 HTTP/SSE 发布预算测试。预算逻辑也由
`@chatverse/world-benchmark` 导出，服务端验收脚本只负责采集事件，不再维护一份
平行的 `scripts/*` 测试实现。

### 真实 Provider 单场景

脚本默认加载 `apps/world-server/.env`,只输出 Provider 类型和模型名,不打印 API Key:

```bash
# 世界场景(五个场景任一)
npm run cvwb:live -- --profile=world --scenario=cvwb-001

# Studio 创作场景
npm run cvwb:live -- --profile=studio

# 常用参数
npm run cvwb:live -- --profile=world --scenario=cvwb-004 --env=apps/world-server/.env --out=.artifacts/world-benchmark --trace-agent-output
```

参数:`--scenario`(支持 ID 前缀匹配)、`--env`、`--out`(产物目录)、`--request-timeout-ms`、`--step-timeout-ms`、`--min-wait-ms`、`--trace-agent-output`。

每次运行保留场景级分数、每条断言结果、可见输出、工具调用、角色生命周期和 Token/稳定性指标。

## 与 world-run-lab 的分工

- `world-run-lab` 只负责 ChatVerse 的运行、Prompt 追踪和结果投影，不再维护自己的场景或
  benchmark 入口。
- CVWB 是唯一的基准目录和测试入口，评分只看可观察结果；第三方引擎可以用同一套场景
  和评分体系做横向对比。

## 许可

场景定义、fixture 文本、评分标准和报告受 [BENCHMARK_LICENSE.md](../packages/world-benchmark/BENCHMARK_LICENSE.md) 约束:允许个人研究、内部评估与非商业工程对比;不得转售、再打包或据此创建竞争性公开测试集。官方分数必须注明基准版本、场景版本、引擎修订、模型配置与适配器修订。
