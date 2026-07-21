# Multi-stage image for the SeoGrep MCP gateway (@pseo/mcp).
# Build from the repo ROOT: `docker build -f apps/mcp/Dockerfile .`
# Turbo prune keeps only this app's slice of the monorepo in the image.

# node:22-alpine — digest-pinned to the current multi-arch index so the base image is immutable
# (D-I3). Refresh the digest deliberately when bumping the Node base; resolve via
# `docker buildx imagetools inspect node:22-alpine`.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

# 1. Prune the monorepo down to @pseo/mcp and its workspace deps (@pseo/core).
# turbo is pinned to this exact version in the root package.json devDependencies (pnpm-lock.yaml),
# so local/CI and this image share ONE turbo version — no drift. The prune runs BEFORE any install
# (its whole purpose is to shrink the workspace first) and .dockerignore strips node_modules from
# the context, so there is no installed turbo binary to `pnpm exec` here; dlx pins the same exact
# version. RESIDUAL (D-I3): sourcing the prune tool from the lockfile itself would require an
# install-before-prune (`pnpm install --frozen-lockfile --ignore-scripts` then `pnpm exec turbo
# prune`), a build-graph change to smoke via `docker build -f apps/mcp/Dockerfile .` before merge.
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.10.4 prune @pseo/mcp --docker

# 2. Install dependencies and compile TypeScript to dist/.
FROM base AS builder
WORKDIR /app
# Manifests + lockfile first so the install layer caches on source-only changes.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Full pruned source, plus the root tsconfig the app extends (prune omits it).
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
# Build the workspace dependency first: @pseo/mcp imports @pseo/core, whose package.json
# resolves to ./dist, so core's dist must exist for BOTH the mcp compile (its .d.ts) and
# runtime (its .js). This is a bare `pnpm --filter` build (not turbo), so `^build` does not
# fire automatically — core is compiled explicitly here, before the app that consumes it.
RUN pnpm --filter @pseo/core run build
RUN pnpm --filter @pseo/mcp run build

# 3. Minimal runtime image: production dependencies + built output only.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV MODE=web
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod
# The prod install links @pseo/core as a workspace symlink
# (apps/mcp/node_modules/@pseo/core -> ../../../../packages/core), so its compiled dist
# must sit at the real workspace path for `import "@pseo/core"` to resolve at runtime.
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/apps/mcp/dist ./apps/mcp/dist
USER node
EXPOSE 8080
CMD ["node", "apps/mcp/dist/index.js"]
