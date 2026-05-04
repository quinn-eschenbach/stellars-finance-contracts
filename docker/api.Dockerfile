# syntax=docker/dockerfile:1.6
#
# api.Dockerfile — single image that serves both the REST/SSE API and the
# built frontend SPA over one port. Multi-stage:
#   1. deps   — install workspace deps from pnpm-lock (cached when manifests
#               are unchanged)
#   2. build  — build the frontend with vite
#   3. runtime — bun runtime, only the api source + built frontend dist
#
# Pre-req on host: bindings must already be generated (`make bind`). They
# live under packages/bindings/ which is gitignored, so we COPY them as-is.

ARG BUN_VERSION=1.1.42

# ---------- deps ----------
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.32.1 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./

# All workspace manifests so pnpm sees the graph.
COPY packages/api/package.json                packages/api/
COPY packages/db/package.json                 packages/db/
COPY packages/config/package.json             packages/config/
COPY packages/bindings/package.json           packages/bindings/
COPY packages/protocol-clients/package.json   packages/protocol-clients/
COPY packages/protocol-math/package.json      packages/protocol-math/
COPY packages/frontend/package.json           packages/frontend/
COPY packages/indexer/package.json            packages/indexer/
COPY packages/keeper/package.json             packages/keeper/
COPY packages/oracle-base/package.json        packages/oracle-base/
COPY packages/oracle-binance/package.json     packages/oracle-binance/
COPY packages/oracle-kucoin/package.json      packages/oracle-kucoin/
COPY packages/oracle-keeper/package.json      packages/oracle-keeper/
COPY packages/simulation/package.json         packages/simulation/

# `--ignore-scripts` skips lifecycle hooks; nothing in this tree needs
# them and a postinstall hook calling `stellar` would crash here.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- build (frontend) ----------
FROM deps AS build
WORKDIR /app
COPY packages/api              packages/api
COPY packages/db               packages/db
COPY packages/config           packages/config
COPY packages/bindings         packages/bindings
COPY packages/protocol-clients packages/protocol-clients
COPY packages/protocol-math    packages/protocol-math
COPY packages/frontend         packages/frontend

RUN pnpm --filter @stellars/frontend build

# ---------- runtime ----------
FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    API_PORT=3030 \
    STATIC_ROOT=/app/public

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules              /app/node_modules
COPY --from=build /app/package.json              /app/package.json
COPY --from=build /app/pnpm-workspace.yaml       /app/pnpm-workspace.yaml
COPY --from=build /app/tsconfig.base.json        /app/tsconfig.base.json
COPY --from=build /app/packages/api              /app/packages/api
COPY --from=build /app/packages/db               /app/packages/db
COPY --from=build /app/packages/config           /app/packages/config
COPY --from=build /app/packages/bindings         /app/packages/bindings
COPY --from=build /app/packages/protocol-clients /app/packages/protocol-clients
COPY --from=build /app/packages/protocol-math    /app/packages/protocol-math
COPY --from=build /app/packages/frontend/dist    /app/public

EXPOSE 3030
WORKDIR /app/packages/api
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3030/api/healthz || exit 1
CMD ["bun", "src/index.ts"]
