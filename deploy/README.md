# Deployment

ChatVerse is a standard Node.js workspace. Production infrastructure is deliberately kept outside this source repository, while this directory contains vendor-neutral examples for self-hosting.

## Build

```bash
npm ci
npm run build
```

The relevant outputs are:

- `frontend/dist`
- `apps/world-server/dist`
- `packages/core/dist`
- `packages/world-authoring/dist`

Start the API server with:

```bash
npm start
```

The server exposes `GET /healthz`. Configuration is documented in [`apps/world-server/.env.example`](../apps/world-server/.env.example).

## Examples

The files under [`examples`](examples/) are intentionally generic. Copy them into your own private infrastructure repository and replace the placeholder hostname, paths, user, and TLS settings there. Do not commit production credentials or host-specific deployment scripts to a public fork.

- `chatverse.service.example`: systemd service template.
- `nginx.conf.example`: static frontend, API proxy, SSE-friendly timeouts.

The root [`Dockerfile`](../Dockerfile) and [`docker-compose.yml`](../docker-compose.yml) provide an alternative container-based starting point.
