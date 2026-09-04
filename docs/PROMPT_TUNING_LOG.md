# World Prompt 调优记录

这份记录用于保存 World Narrator 与 World Actor 的真实 Provider 长程测试、Prompt 调整和非 Prompt 问题。每轮调优都先记录基线，再记录改动和复测结果；运行时故障不通过 Prompt 掩盖。

> 本文保留 2026-08-12 的历史实验记录。旧的 `world:lab` 固定场景入口已随
> CVWB 整合移除；新的确定性和真实 Provider 验收统一使用 `npm run cvwb:test`
> 与 `npm run cvwb:live -- --profile=world|studio`，历史命令不应再照抄执行。

## 2026-08-12 · 基线

基线提交：`b738e00 fix(core): tighten narrator repetition guidance`

已确认旧的残留题目文件在该提交中删除。此次基线使用真实 DeepSeek Provider，测试入口为 `@chatverse/world-run-lab`，完整命令保存在实验产物目录对应的运行记录中。

### 五行山 · 50 事件目标

命令：

```text
npm run world:lab -- --live --load-env-file=apps/world-server/.env --scenario=five-elements-mountain --target-events=50 --checkpoints=20,40 --request-timeout-ms=30000 --step-timeout-ms=180000 --out=.artifacts/world-run-lab/baseline-20260812-five-elements
```

- 结果：32 / 50 个事件，单步等待超时。
- Provider 请求：34；总 Token：89,312；缓存命中率：53.9%。
- 请求分布：Narrator 16 次、Actor 16 次、Director 2 次。
- 输出：7 段旁白、16 条消息、4 个动作、2 个 Beat。
- 内容问题：同一地点和风声被反复渲染；角色已经表达“停下、等待、揭帖”等动作后，旁白再次补拍；唐三藏围绕同一确认反复回应。
- 非 Prompt 问题：结束时存在 `generating=1`，且没有后续 Provider usage 或错误通知，运行器在 Actor 生成任务上等待超时。

### 归潮-7 · 30 事件目标

命令：

```text
npm run world:lab -- --live --load-env-file=apps/world-server/.env --scenario=abyssal-contradiction --target-events=30 --checkpoints=15,25 --request-timeout-ms=30000 --step-timeout-ms=180000 --out=.artifacts/world-run-lab/baseline-20260812-abyssal
```

- 结果：29 / 30 个事件，单步等待超时。
- Provider 请求：30；总 Token：89,455；缓存命中率：53.2%。
- 输出：7 段旁白、15 条消息、2 个动作、2 个 Beat。
- 内容问题：数段旁白都在重复“需要现场确认”和已出现的局面，解释性旁白与普通环境复述边界仍不清楚。
- 非 Prompt 问题：同样停留在 `generating=1`，没有对应的 Provider usage 或错误通知；权限纠正、临时角色和 checkpoint 检查因未走到后续步骤而无法评估。

### 赤壁 Handoff · 35 事件目标

命令：

```text
npm run world:lab -- --live --load-env-file=apps/world-server/.env --scenario=red-cliffs-handoff --target-events=35 --checkpoints=15,30 --request-timeout-ms=30000 --step-timeout-ms=180000 --out=.artifacts/world-run-lab/baseline-20260812-red-cliffs
```

- 结果：34 / 35 个事件，边界处存在未排空 scheduled 任务。
- Provider 请求：27；总 Token：75,983；缓存命中率：53.0%。
- Handoff 链：3；无 Handoff 错误；旧 Narrator 未调用。
- 内容问题：相邻旁白存在近乎相同的案情环境铺陈；最终可读性检查只命中“撤退”和“火”两个关键词。
- 非 Prompt 问题：Handoff 模式的 Actor/Narration 前缀缓存较低，约 50.08% / 37.58%；结束时 scheduled 边界任务没有及时结算。

## 2026-08-12 · 第 1 轮 Prompt 调整

目标：只减少重复旁白和角色的确认式复述，不增加正文过滤、相似度阈值、硬拒绝、事实数据库或运行时去重。

### Narrator

- 增加固定判断顺序：先检查触发事件有没有新结果，再检查时间线是否已经展示；没有新结果或已经展示就返回 `null`。
- 明确角色已提交的动作、决定和消息不能被旁白重新“补拍”；只有观众无法理解其空间、因果、时间或局面结果时才做最短桥接。
- 明确一轮最多一段旁白；普通角色输出、等待、轻微姿态和持续环境都不需要旁白。

### Actor

- 将“简短回应可以有节奏价值”收紧为：必须有具体关系、情绪或节奏作用，单纯同意、确认和复述应保持安静。
- 增加“新增贡献检查”：每次 `perform` 先找出新的观察、判断、结果、动作、关系反应或推进决定。
- 明确不能换词重述他人已经说清的事实，也不能在下一条再次描述自己已经公开的动作。

验证：Core 105 项测试通过，Core typecheck 通过，World Run Lab build 通过。当前工作树的 Prompt 改动尚未用真实 Provider 复测，待本记录下一节补充。

补充回放：`--mock --accelerated --scenario=five-elements-mountain --target-events=50` 在第 41 个事件满足全部剧情检查并正常排空，但脚本没有继续产生第 42–50 个事件，因此只被“事件数量”检查判为失败。该问题属于基准脚本的目标数量与 `stopWhen`/步骤数量不一致，不属于 Prompt 或 World 运行时故障；同时确认 Mock 回放无错误、无卡死、无残留任务。

真实复测：`--live --scenario=five-elements-mountain --target-events=30 --checkpoints=20 --request-timeout-ms=30000 --step-timeout-ms=120000` 在 20 个事件处停止。产生 24 次请求、56,047 Token，缓存命中率 66.7%；其中 Narrator 11 次、Actor 12 次、Director 1 次。内容中仍出现一次开场近义旁白，以及对“靠近、查看、怀疑、等待”已提交输出的总结式旁白。结束状态为 `scheduled=0,generating=0,triggers=0`，无 World/Provider 错误；测试仍报告收敛超时，需继续区分实验运行器等待条件与核心生成卡死。

## 2026-08-12 · 第 2 轮 Prompt 调整

目标：继续保持纯 Prompt 调优，不加入旁白正文去重、不加入相似度过滤、不修改运行时调度。

- Narrator 明确初始 `Context timeline` 已有开幕旁白时，`open_beat` 默认不再重写开场。
- Narrator 明确“把多条已展示的消息总结成一段”不构成桥接；角色已表达的移动、查看、等待、判断、承诺和质疑不再补拍或总结。
- Narrator 保留必要的小说式解释，只在观众无法从已提交输出理解变化时使用。
- Actor 明确同一问题得到回答后不能换句重复追问，必须提出能改变局面的验证/决定或等待新信息。

真实复测：

- 归潮-7：25 / 25 事件完成，13 条消息、7 段旁白、1 个 Beat；关键因果锚点 6/7，旁白没有代写对白，事实来源检查通过，稳定性通过。脚本预设的权威修正和临时角色步骤没有走到，因此对应检查失败；不是运行错误。
- 赤壁 Handoff：21 / 30 事件，2 条 Handoff 链、16 次接力、无运行时错误、未调用旧 Narrator；在 `scheduled=1` 边界等待超时，属于 Handoff 排程/实验终止问题。
- 五行山：12 / 20 事件，缓存命中率 71.3%，仍在开幕后出现一次近似旁白；没有 World/Provider 错误，但运行器报告收敛超时。该结果促成第 3 轮只收紧 `open_beat` 的模式引导，不增加运行时去重。

## 2026-08-12 · 第 3 轮 Prompt 调整

只针对五行山复测暴露的开幕重复：`open_beat` 现在明确“开幕优先让角色表达”；当 `Context timeline` 或 `sceneNow` 已经展示开场环境时，本轮 `narration` 默认必须为 `null`，除非有新的可观察结果或不可替代的桥接。新增 Prompt 契约测试，不改变 Narrator 解析、调度或事件流。

短真实复测：12 / 12 事件，9 次请求，20,084 Token，缓存命中率 72.2%，无 World/Provider 错误、卡死或残留任务。初始开场旁白没有立即重复，但在角色已经逐条说明呼救、靠近和询问法帖后，仍出现一段回顾性总结。该结果触发第 4 轮微调。

## 2026-08-12 · 第 4 轮 Prompt 调整

只补充 Narrator 的内容边界：旁白不是对话回放、剧情摘要或观众解说；当连续消息和 action 已经让观众知道位置、观察、问题和行动原因时，必须等待真正的新结果，不得改写成小说段落。仍不加入正文去重或运行时规则。

最终短真实复测：9 / 12 事件，10 次请求，21,594 Token，缓存命中率 72.3%。输出包含初始旁白、角色连续说明呼救/询问和一段新的旁白；没有再出现对前几条角色消息的回顾性总结。测试在 `scheduled=1` 边界超时，但没有 World/Provider 错误；这是现有实验收敛边界问题，已列入非 Prompt 清单。

本轮 Prompt 调优到此停止。后续若仍出现重复，应优先修复 Narrator 调度/实验收敛与上下文投影，而不是继续堆叠系统提示词。

## 非 Prompt 问题清单

这些问题不能靠继续堆系统提示词解决，后续应单独立项：

1. Actor 生成任务出现 `generating=1`，但没有 Provider usage、错误或完成通知，导致长程运行器等待到超时。
2. Handoff 模式在 scheduled 边界结束，说明排程任务的结算与实验终止条件仍有边界竞态。
3. 实际缓存命中率约 53%，低于预期；Handoff 的动态上下文变化和前缀布局需要独立追踪，不能和旁白重复混为同一个 Prompt 问题。
4. 现有长程实验在首次步骤发生卡住时，后续内容检查和 checkpoint 不能完成；需要先改善测试观测与停止原因分类，再据此评价完整剧情质量。

## 2026-08-12 · 第 5 轮 Prompt 调整

归潮-7 当前版本真实复测：29 / 30 事件，35 次 Provider 请求，105,580 Token，缓存命中率 52.6%；16 条角色消息、6 段旁白、2 个 Beat。旁白没有直接代写对白，也没有在来源前凭空增加关键数字或人员状态；普通事件没有覆盖运行中的 Beat。

本轮仍观察到一段不合格旁白：角色已经提交“暂缓开门、固定 20 分钟窗口、继续核验”的决定后，旁白重新播报证据链，并把“来源未闭合”推成“触发源只能来自舱内”。这不是新场景事实，而是 sceneNow 朗读、角色决定回放和未经来源支持的排他性推断。

本轮只增加两条 Narrator Prompt 约束：

- `sceneNow` 可以静默更新，但不是旁白正文；角色已经提交的决定、证据汇总、倒计时、待办和未解决问题，不得再次播报，没有新的外部结果时返回 `null`。
- “尚未确认”“证据未闭合”“未发现迹象”必须保持未知状态，不得写成“只能来自”“必然是”“已经确定”等排他性结论。

增加了 Narrator Prompt 契约测试，Core 107 项测试、typecheck 通过。随后五行山短真实复测用于确认这两条边界没有让 Narrator 停摆；结果追加在本节后方。

### 非 Prompt 观察

- 本轮归潮-7 仍在 `scheduled=1, generating=0` 边界超时，但结束时没有活动请求、错误或残留任务；这是 World Run Lab 的收敛/排程边界，不用 Prompt 修复。
- 本轮没有触发临时角色、权威修正或冷恢复检查，因此这些内容质量项不能据此判定通过或失败。

五行山当前版本短真实复测：12 / 12 事件，6 次请求，16,405 Token，缓存命中率 66.4%，完成一次冷恢复；初始开场旁白只出现一次，随后由唐三藏和玩家推进对话，没有重复开场或动作总结旁白。运行期间无错误、超时、卡死或残留任务。短测没有达到临时角色离场和剧情图深度验收阈值，不能替代长程测试。

## 后续记录规则

- 每轮只改一组明确 Prompt 目标，并在这里记录版本、场景、命令、输出指标和内容观察。
- 如果复测仍出现相同重复，先比较具体上下文和模型输出，再决定是 Prompt 还是运行时/上下文结构问题。
- 不因一次正常或异常输出直接加入硬编码正文规则；硬规则只用于协议和生命周期安全，不用于改写内容。
