ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base

ARG PNPM_VERSION=10.29.3
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g --force corepack@latest && corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
RUN apk add --no-cache libc6-compat

# ==========================================
# Builder Stage (Unified)
# ==========================================
FROM base AS builder
WORKDIR /app
RUN pnpm install -g turbo
COPY . .
RUN turbo prune @ubichill/backend @ubichill/frontend --docker --out-dir out

# ==========================================
# Installer & Builder Stage
# ==========================================
FROM base AS installer
WORKDIR /app

# Install dependencies referenced in lockfile
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
# --ignore-scripts is needed because some prepare scripts (e.g. panda codegen) fail without source
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json

# Build environment variables
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Build everything
RUN pnpm run build

# 配置用設定 (Docker内のみで有効)
# pnpm deployには inject-workspace-packages=true が必要
RUN echo "inject-workspace-packages=true" > .npmrc

# Backend Deploy
# これにより、必要なprod依存関係とビルド済みファイルが /app/deploy-backend に集約される
RUN pnpm --filter="@ubichill/backend" --prod deploy /app/deploy-backend

# ==========================================
# Backend Runner
# ==========================================
FROM base AS backend-runner
WORKDIR /app
USER node

# Deployed application is self-contained (includes node_modules, dist, package.json, and workspace deps)
COPY --from=installer --chown=node:node /app/deploy-backend .

EXPOSE 3001
CMD ["node", "dist/index.js"]

# ==========================================
# Frontend Runner
# ==========================================
FROM base AS frontend-runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
USER node

COPY --from=installer --chown=node:node /app/packages/frontend/public ./packages/frontend/public
COPY --from=installer --chown=node:node /app/packages/frontend/.next/static ./packages/frontend/.next/static
COPY --from=installer --chown=node:node /app/packages/frontend/.next/standalone ./

EXPOSE 3000
CMD ["node", "packages/frontend/server.js"]

# ==========================================
# Development Stage
# ==========================================
FROM base AS development
WORKDIR /app

# Install git for watch mode/tools
RUN apk add --no-cache git

# Copy all source files
COPY . .

# Install all dependencies (including devDependencies)
RUN pnpm install --frozen-lockfile

# Default command (can be overridden)
CMD ["pnpm", "dev"]
