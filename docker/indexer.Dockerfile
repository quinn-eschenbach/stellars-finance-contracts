# syntax=docker/dockerfile:1.6
#
# indexer.Dockerfile — Stellar event ingester. Node-based runtime (the
# package builds via tsc), so we get a smaller final image than the
# bun-based services.

ARG NODE_VERSION=22

# ---------- deps ----------
# tsc (in build) needs Node on PATH; Node ships corepack so we get pnpm for free.
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.32.1 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
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

RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- build ----------
FROM deps AS build
WORKDIR /app
COPY packages/indexer          packages/indexer
COPY packages/db               packages/db
COPY packages/config           packages/config
COPY packages/bindings         packages/bindings
COPY packages/protocol-clients packages/protocol-clients

# Build the workspace libs first — tsc resolves `@stellars/db` via
# dist/index.d.ts, so they must exist before indexer's tsc runs. Pnpm's
# `...<pkg>` topological filter doesn't reliably pick up the deps in a
# single run, so we list the libs explicitly.
RUN pnpm --filter "@stellars/db" \
         --filter "@stellars/config" \
         --filter "@stellars/protocol-clients" \
         build \
    && pnpm --filter "@stellars/indexer" build

# ---------- runtime ----------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules              /app/node_modules
COPY --from=build /app/package.json              /app/package.json
COPY --from=build /app/pnpm-workspace.yaml       /app/pnpm-workspace.yaml
COPY --from=build /app/packages/indexer          /app/packages/indexer
COPY --from=build /app/packages/db               /app/packages/db
COPY --from=build /app/packages/config           /app/packages/config
COPY --from=build /app/packages/bindings         /app/packages/bindings
COPY --from=build /app/packages/protocol-clients /app/packages/protocol-clients

WORKDIR /app/packages/indexer
EXPOSE 3001
# Health server answers any path with status JSON (returns 503 if no
# poll has landed in the last 30s).
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3001/ || exit 1
CMD ["node", "dist/index.js"]
