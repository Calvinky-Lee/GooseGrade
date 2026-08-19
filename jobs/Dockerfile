# ONE image, three subcommands — design decision D3.
#
# Two near-identical images drift. One image with a CLI entrypoint does not, and it means a
# `scheme_confidence` value in the catalog is traceable to a single image digest, which pins the
# exact engine version that validated it.
#
# Deliberately does NOT contain the Next.js app. Before the workspace split, the scraper would
# have installed React, Radix and recharts to fetch some HTML.

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# --- dependencies -----------------------------------------------------------
FROM base AS deps

# Only the manifests first, so a source change does not invalidate the install layer.
COPY package.json package-lock.json ./
COPY jobs/package.json ./jobs/
COPY packages/engine/package.json ./packages/engine/
COPY packages/types/package.json ./packages/types/

# The web app and the API package are not installed at all: --workspace limits the tree to the
# jobs workspace and its two local dependencies.
RUN npm ci --omit=dev --workspace @goosegrade/jobs --include-workspace-root \
 && npm cache clean --force

# --- runtime ----------------------------------------------------------------
FROM base AS runtime

# tsx runs the TypeScript directly. The packages ship raw TS with no build step, so there is one
# source of truth per module and no dist/ to go stale between the app and this image.
RUN npm install -g tsx@4 && npm cache clean --force

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY jobs ./jobs
COPY packages/engine ./packages/engine
COPY packages/types ./packages/types

# Non-root: this image holds a service-role key at runtime, so it gets no more privilege than
# it needs.
USER node

# Sharding comes from the environment, so the same image runs unchanged under kind, Cloud Run,
# and GKE — see jobs/src/shard.ts.
ENTRYPOINT ["tsx", "jobs/src/cli.ts"]
CMD ["help"]
