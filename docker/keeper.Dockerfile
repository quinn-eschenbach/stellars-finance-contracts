# syntax=docker/dockerfile:1.6
#
# keeper.Dockerfile — automated keeper bot (TP/SL, liquidations, ADL).
# Bun-based; no build step, runs the .ts source directly.

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
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules            /app/node_modules
COPY --from=deps /app/package.json            /app/package.json
COPY --from=deps /app/pnpm-workspace.yaml     /app/pnpm-workspace.yaml
COPY --from=deps /app/tsconfig.base.json      /app/tsconfig.base.json

COPY packages/keeper            packages/keeper
COPY packages/db                packages/db
COPY packages/config            packages/config
COPY packages/bindings          packages/bindings
COPY packages/protocol-clients  packages/protocol-clients
COPY packages/protocol-math     packages/protocol-math

WORKDIR /app/packages/keeper
# Keeper has no HTTP healthcheck endpoint; docker watches the process.
# If it crashes, compose restart policy brings it back.
CMD ["bun", "src/index.ts"]
