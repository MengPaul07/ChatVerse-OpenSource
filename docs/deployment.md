---
title: 自托管部署
description: 构建并部署 ChatVerse 的通用说明。
category: start
order: 4
---

# 自托管部署

ChatVerse 不绑定特定云厂商或生产拓扑。源码仓库只提供可复用的构建流程和配置示例，实际域名、服务器地址、TLS 证书、SSH 目标、回滚策略与生产环境变量应保存在部署者自己的私有运维仓库中。

## 构建

```bash
npm ci
npm run build
```

主要产物包括 `frontend/dist`、`apps/world-server/dist`、`packages/core/dist` 和 `packages/world-authoring/dist`。API 服务可通过以下命令启动：

```bash
npm start
```

服务默认提供 `GET /healthz` 健康检查。环境变量见 `apps/world-server/.env.example`。

## 部署方式

- 容器：从仓库根目录的 `Dockerfile` 与 `docker-compose.yml` 开始。
- 裸机：参考 `deploy/examples` 中的 systemd 与 Nginx 模板。
- 托管平台：将前端静态产物与 Node.js API 分别部署，并把 `/api/` 反向代理到 API 服务。

生产配置中请特别注意：

- 将域名、主机名、SSH 用户和文件路径替换为自己的环境。
- 将密钥放入环境文件或 Secret Manager，不写入仓库。
- SSE 路由需要关闭代理缓冲，并设置足够长的读写超时。
- 为发布过程配置互斥、健康检查、备份和失败回滚。

更多细节见 [`deploy/README.md`](../deploy/README.md)。
