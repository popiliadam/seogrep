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
# turbo comes from the LOCKFILE, not from a floating registry fetch (D-I3 residual / L-18).
# `pnpm dlx turbo@2.10.4` re-resolved the version at build time with NO integrity check against
# pnpm-lock.yaml: the version string matched the root devDependency, but nothing tied the bytes
# to the ones the lockfile records, so a re-published or tampered 2.10.4 would have entered the
# build silently — in the stage that decides which source files reach the image.
#
# `--filter pseo-saas` installs ONLY the workspace ROOT project (named for its package.json
# `name`, so a rename breaks the build loudly instead of quietly installing the whole monorepo),
# whose devDependencies carry turbo. That keeps the prune's whole purpose intact: the workspace
# packages are still installed AFTER the prune, from the pruned manifest set (stage 2), never
# from the full monorepo. `--frozen-lockfile` makes a lockfile that disagrees with package.json a
# BUILD FAILURE rather than a silent re-resolution, and `--ignore-scripts` keeps install-time
# lifecycle scripts out of the build. The pruner's node_modules never leaves this stage — later
# stages copy only /app/out.
#
# `pnpm exec turbo --version` is kept as a one-line build-log assertion: `exec` runs the LOCAL
# node_modules binary (never a registry fetch), so a build log that prints the pinned version is
# itself the evidence the prune tool came from the lockfile.
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter pseo-saas \
 && pnpm exec turbo --version \
 && pnpm exec turbo prune @pseo/mcp --docker

# 2. Install dependencies and compile TypeScript to dist/.
FROM base AS builder
WORKDIR /app
# Manifests + lockfile first so the install layer caches on source-only changes.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Full pruned source, plus the root tsconfig the app extends (prune omits it).
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
# Build the workspace dependencies first: @pseo/mcp imports @pseo/core AND @pseo/db, whose
# package.json exports resolve to ./dist, so their dist must exist for BOTH the mcp compile
# (their .d.ts) and runtime (their .js). This is a bare `pnpm --filter` build (not turbo), so
# `^build` does not fire automatically — each dependency is compiled explicitly here, in
# dependency order (db itself imports core), before the app that consumes them. This hand-kept
# list is exactly what broke on 2026-08-14: mcp gained the @pseo/db dependency, verify.sh
# stayed green (turbo builds ^build), and only this Dockerfile still listed core alone.
RUN pnpm --filter @pseo/core run build
RUN pnpm --filter @pseo/db run build
RUN pnpm --filter @pseo/mcp run build

# 3. Minimal runtime image: production dependencies + built output only.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV MODE=web
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod
# The prod install links @pseo/core and @pseo/db as workspace symlinks
# (apps/mcp/node_modules/@pseo/core -> ../../../../packages/core, same for db), so their
# compiled dist must sit at the real workspace paths for the imports to resolve at runtime.
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/apps/mcp/dist ./apps/mcp/dist
USER node
EXPOSE 8080
CMD ["node", "apps/mcp/dist/index.js"]
