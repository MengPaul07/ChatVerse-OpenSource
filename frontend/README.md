# ChatVerse Frontend

ChatVerse 的独立产品前端。默认提供公开编排展示入口，也支持在填写本机模型 Key 后进入《西游记 · 五行山》世界：旁白、角色对话、剧情流与 Director 体验方式在同一界面中呈现。

旧演示目录已移除；当前前端是唯一的产品入口。

## 开发

```bash
npm install
npm run dev
```

默认开发地址为 `http://127.0.0.1:5173`。公开编排展示不依赖本地 API；运行世界和创作工具会通过同源 API 使用设置页中的本机 Key。

## 验证

```bash
npm run lint
npm run test
npm run build
```

界面规范见 [Interface Design System](./.interface-design/system.md)。
