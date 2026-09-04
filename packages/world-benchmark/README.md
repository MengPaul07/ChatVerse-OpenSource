# ChatVerse WorldBench

ChatVerse WorldBench（CVWB）是面向语言驱动世界运行时的结果导向基准测试集。
它测试输入、可观察结果、状态变化、工具副作用、稳定性和成本，不要求被测引擎
必须使用 Narrator、Director 或某一种调度结构。

## 当前版本

第一版包含五个场景：

- `cvwb-001-absent-witness`：玩家要求不在场的目击者出现，验证临时角色升级。
- `cvwb-002-contradictory-evidence`：矛盾命令与事实修正，验证知识和权限边界。
- `cvwb-003-crowd-relevance`：十二人会议，验证相关性调度和反轮询。
- `cvwb-004-recovery-and-continuity`：故障、暂停和恢复，验证不重复提交。
- `cvwb-005-transition-beat-spawn`：规划新幕时创建临时角色，验证 spawn、Beat 与实际演出的完整落地链。

Studio profile 另包含：

- `cvwb-studio-001-research-to-world`：从空白草稿联网检索并在同一次 Agent loop 中形成角色、玩家、场景和剧情线 ChangeSet。

场景输入是稳定的语义协议，运行时通过 `BenchmarkEngineAdapter` 接入。当前
ChatVerse 的 `world-run-lab` 会作为第一个适配器接入；适配器只负责把引擎轨迹
投影为标准观察结果。世界场景、Studio 场景和发布预算由同一个 CVWB catalog
管理，可通过 `createCVWBSuiteRegistry()` 统一发现。

## 评分

每个场景由确定性断言、运行指标和盲评 Judge 共同评分。断言负责事件顺序、角色
生命周期、工具结果和预算；Judge 负责重复、清晰度、因果连续性和玩家意图响应。
没有 Judge 分数时，报告会明确显示 `needs_judge`，不会把缺失评分伪装成通过。

## 运行方式

基准只规定输入和观察结果，具体引擎通过适配器接入：

```ts
import {
  createWorldBenchV1Scenarios,
  runBenchmarkSuite,
} from "@chatverse/world-benchmark";
import { createChatVerseWorldBenchAdapter } from "@chatverse/world-run-lab";

const adapter = createChatVerseWorldBenchAdapter({ providers });
const report = await runBenchmarkSuite(
  adapter,
  createWorldBenchV1Scenarios(),
  { repeats: 3 },
);
console.log(report.result.aggregate);
```

每次运行都会保留场景级分数、每条断言结果、可见输出、工具调用、角色生命周期和
Token/稳定性指标。当前 ChatVerse 适配器已经覆盖普通消息、世界事件、导演指令、
暂停/恢复、快照和恢复；故障注入与世界时钟动作会明确报告为未支持，不会静默跳过。

仓库内可直接使用已配置的真实 OpenAI-compatible Provider 运行单场景：

```bash
npm run cvwb:live -- --profile=world --scenario=cvwb-001
npm run cvwb:live -- --profile=studio
```

脚本默认加载 `apps/world-server/.env`，只输出 Provider 类型和模型名，不打印 API Key。

严重失败包括崩溃、永久卡死、状态损坏和关键权限/事实泄漏。严重失败会把场景
最高分限制为 39 分。

版权与使用限制见 [BENCHMARK_LICENSE.md](./BENCHMARK_LICENSE.md)。
