---
title: World Source
description: 把长篇资料编译成可检索、可追溯的世界参考层。
category: concepts
order: 5
---

# World Source

World Source 为 Director 提供可检索的长篇创作依据。它适合小说、设定集、课程材料和多章节世界书，不会把整份正文塞进每次模型请求。

## 数据流

```text
Markdown / TXT
  -> 章节解析与稳定分块
  -> 本地 BM25 索引
  -> IndexedDB Source Library
  -> WorldDraft 仅绑定 bundleId + revision + fidelity
  -> 创建房间时把绑定版本临时送入 Server 内存
  -> Director 按需 inspect / search / read
  -> Beat 保存引用的 bundle、revision 与 chunkIds
```

Actor、Narrator、Group 和私聊不会读取 Source 正文。Source 只参与 Director 规划新 Beat，幕内已经提交的玩家选择和世界事实始终优先。

## 遵循方式

- `strict`：尽量遵循原作因果；玩家造成的已提交变化优先。
- `reference`：保留关键设定与人物逻辑，允许合理改编。
- `free`：仅作为灵感，不要求复现原剧情。

## Director 检索

Source 绑定后，Director 只在稳定前缀中看到资料目录。需要正文时按顺序调用：

1. `inspect_source_index` 或 `search_source`
2. `read_source_chunks`
3. 在后续工具轮次调用 `plan_beat`

检索与 `plan_beat` 不能位于同一工具轮次。引用正文的 Beat 必须写入 `sourceBasis`，Host 会校验资料包、冻结版本和 chunk ID。

## 当前边界

- 支持 `.md` 与 `.txt`。
- 默认分块目标约 1000 字符，重叠约 120 字符。
- 中文检索使用 `Intl.Segmenter` 与 CJK bigram；无需外部向量数据库。
- 单房间最多 8 个资料包、128 个文档、5000 个块和约 500 万原文字符。
- 单个编译包最多 48MB；一个世界绑定的编译包合计最多 64MB，超限时前端会在启动前提示拆分。
- Source 原文不写入 World Archive；恢复房间时由浏览器重新提供绑定版本。
- 被草稿或世界存档引用的 Source 不能直接删除，解除绑定后才可清理。
- 不解析 PDF、DOCX、网页或图片；这些格式留给后续独立导入转换层。
