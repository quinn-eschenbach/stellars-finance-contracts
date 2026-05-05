# syntax=docker/dockerfile:1.6
#
# oracle.Dockerfile — parameterized image for the CEX price publishers.
# Build once per source by setting `ORACLE_PACKAGE` to the workspace name
# under packages/ (e.g. `oracle-binance`, `oracle-kucoin`). Both publishers
# share the same workspace dependency graph, so deps install is identical;
# only the entrypoint changes.
#
# Bun-based; no compile step, runs the .ts source directly. No DB
# dependency, no exposed ports — these are outbound-only processes that
# fetch CEX prices and call `publish_price` on a deployed Oracle contract.
#
# Pre-req on host: bindings must already be generated (`make bind`).

ARG BUN_VERSION=1.1.42
ARG NODE_VERSION=22

# ---------- deps ----------
# Node-based deps so corepack is available; runtime stays on bun below
# since the publisher runs `bun src/index.ts` directly.
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

# ---------- runtime ----------
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ARG ORACLE_PACKAGE
WORKDIR /app
ENV NODE_ENV=production \
    ORACLE_PACKAGE=${ORACLE_PACKAGE}
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules            /app/node_modules
COPY --from=deps /app/package.json            /app/package.json
COPY --from=deps /app/pnpm-workspace.yaml     /app/pnpm-workspace.yaml
COPY --from=deps /app/tsconfig.base.json      /app/tsconfig.base.json

# Both oracle packages depend on oracle-base + bindings + protocol-clients +
# config; copy the full set so workspace symlinks resolve at runtime
# regardless of which publisher this image will run.
COPY packages/oracle-base       packages/oracle-base
COPY packages/oracle-binance    packages/oracle-binance
COPY packages/oracle-kucoin     packages/oracle-kucoin
COPY packages/bindings          packages/bindings
COPY packages/config            packages/config
COPY packages/protocol-clients  packages/protocol-clients

WORKDIR /app/packages/${ORACLE_PACKAGE}
# No HTTP healthcheck — the publisher is a long-running loop. Compose
# restart policy brings it back if the process exits.
CMD ["bun", "src/index.ts"]
