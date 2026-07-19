# Multi-stage image for the SeoGrep MCP gateway (@pseo/mcp).
# Build from the repo ROOT: `docker build -f apps/mcp/Dockerfile .`
# Turbo prune keeps only this app's slice of the monorepo in the image.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

# 1. Prune the monorepo down to @pseo/mcp (and its workspace deps — currently none).
FROM base AS pruner
WORKDIR /app
RUN pnpm add -g turbo@2.10.4
COPY . .
RUN turbo prune @pseo/mcp --docker

# 2. Install dependencies and compile TypeScript to dist/.
FROM base AS builder
WORKDIR /app
# Manifests + lockfile first so the install layer caches on source-only changes.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Full pruned source, plus the root tsconfig the app extends (prune omits it).
COPY --from=pruner /app/out/full/ .
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @pseo/mcp run build

# 3. Minimal runtime image: production dependencies + built output only.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV MODE=web
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/apps/mcp/dist ./apps/mcp/dist
USER node
EXPOSE 8080
CMD ["node", "apps/mcp/dist/index.js"]
