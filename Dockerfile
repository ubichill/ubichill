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
COPY scripts/ scripts/

# Build environment variables
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# フロントエンドのコミットハッシュ（ビルド時に Next.js へ静的埋め込み）
ARG NEXT_PUBLIC_COMMIT_HASH=unknown
ENV NEXT_PUBLIC_COMMIT_HASH=${NEXT_PUBLIC_COMMIT_HASH}

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

# Build everything
RUN pnpm run build

# 配置用設定 (Docker内のみで有効)
# pnpm deployには inject-workspace-packages=true が必要
RUN echo "inject-workspace-packages=true" > .npmrc

# Backend Deploy
# これにより、必要なprod依存関係とビルド済みファイルが /app/deploy-backend に集約される
RUN pnpm --filter="@ubichill/backend" --prod deploy /app/deploy-backend

# Frontend Deploy (pnpm の完璧な node_modules を生成)
# standalone の node_modules は pnpm 仮想ストアのシンボリックリンク問題で不完全なため、
# pnpm deploy が作る解決済みの node_modules に差し替えてイメージの完全性を確保する。
RUN pnpm --filter="@ubichill/frontend" --prod deploy --ignore-scripts /app/deploy-frontend \
    # server.js: standalone が生成した固有のエントリポイント
    && cp packages/frontend/.next/standalone/packages/frontend/server.js /app/deploy-frontend/server.js \
    # .next/server/: ページバンドルと各種マニフェスト (server-side rendering に必須)
    && cp -r packages/frontend/.next/server /app/deploy-frontend/.next/ \
    # .next/ 直下のファイル群: BUILD_ID・routes-manifest.json 等 Next.js が起動時に読むもの
    && find packages/frontend/.next -maxdepth 1 -type f -exec cp {} /app/deploy-frontend/.next/ \; \
    # static アセット (CSS/JS チャンク、クライアント向け)
    && cp -r packages/frontend/.next/static /app/deploy-frontend/.next/ \
    # public ディレクトリ (画像・フォント等)
    && cp -r packages/frontend/public /app/deploy-frontend/public

# ==========================================
# Backend Runner
# ==========================================
FROM node:${NODE_VERSION}-alpine AS backend-runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

USER node
COPY --from=installer --chown=node:node /app/deploy-backend .

EXPOSE 3001
CMD ["node", "dist/index.js"]

# ==========================================
# Frontend Runner
# ==========================================
FROM node:${NODE_VERSION}-alpine AS frontend-runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

USER node
COPY --from=installer --chown=node:node /app/deploy-frontend .

EXPOSE 3000
CMD ["node", "server.js"]

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
