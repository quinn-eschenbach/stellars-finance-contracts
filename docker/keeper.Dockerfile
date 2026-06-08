# syntax=docker/dockerfile:1.6
#
# keeper.Dockerfile — automated keeper bot (TP/SL, liquidations, ADL).
# Bun-based; no build step, runs the .ts source directly.

ARG BUN_VERSION=1.1.42
ARG NODE_VERSION=22

# ---------- deps ----------
# Node-based deps stage so corepack is available; runtime stays on bun
# below since the keeper runs `bun src/index.ts` directly.
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.32.1 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
# pnpm-workspace.yaml declares patchedDependencies; the patch must be present
# so the frozen-lockfile install can hash it before resolving the graph.
COPY patches/ patches/
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
COPY packages/simulation/package.json         packages/simulation/

RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------- build (workspace libs) ----------
# Keeper runs from src via bun, but its imports (@stellars/db etc.) resolve
# through package.json's `main: dist/index.js` — those dists must exist or
# runtime fails. We build only the libs (not keeper itself).
FROM deps AS build
WORKDIR /app
COPY packages/db                packages/db
COPY packages/config            packages/config
COPY packages/bindings          packages/bindings
COPY packages/protocol-clients  packages/protocol-clients
COPY packages/protocol-math     packages/protocol-math
COPY packages/keeper            packages/keeper
RUN pnpm --filter "@stellars/db" \
         --filter "@stellars/config" \
         --filter "@stellars/protocol-clients" \
         --filter "@stellars/protocol-math" \
         build

# ---------- runtime ----------
FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules            /app/node_modules
COPY --from=build /app/package.json            /app/package.json
COPY --from=build /app/pnpm-workspace.yaml     /app/pnpm-workspace.yaml
COPY --from=build /app/tsconfig.base.json      /app/tsconfig.base.json

COPY --from=build /app/packages/keeper            packages/keeper
COPY --from=build /app/packages/db                packages/db
COPY --from=build /app/packages/config            packages/config
COPY --from=build /app/packages/bindings          packages/bindings
COPY --from=build /app/packages/protocol-clients  packages/protocol-clients
COPY --from=build /app/packages/protocol-math     packages/protocol-math

WORKDIR /app/packages/keeper
# Keeper has no HTTP healthcheck endpoint; docker watches the process.
# If it crashes, compose restart policy brings it back.
CMD ["bun", "src/index.ts"]
