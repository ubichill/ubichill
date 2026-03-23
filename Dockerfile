ARG NODE_VERSION=22
ARG PNPM_VERSION=10.29.3

# ==========================================
# base: pnpm + bookworm-slim
# ==========================================
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g --force corepack@latest \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate

# ==========================================
# deps: package.json のみ先行コピー → pnpm install
# ソースが変わっても依存キャッシュが切れないようにする
# ==========================================
FROM base AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/backend/package.json        ./packages/backend/package.json
COPY packages/db/package.json             ./packages/db/package.json
COPY packages/engine/package.json         ./packages/engine/package.json
COPY packages/frontend/package.json       ./packages/frontend/package.json
COPY packages/react/package.json          ./packages/react/package.json
COPY packages/sandbox/package.json        ./packages/sandbox/package.json
COPY packages/sdk/package.json            ./packages/sdk/package.json
COPY packages/shared/package.json         ./packages/shared/package.json
COPY plugins/avatar/frontend/package.json       ./plugins/avatar/frontend/package.json
COPY plugins/pen/frontend/package.json          ./plugins/pen/frontend/package.json
COPY plugins/video-player/frontend/package.json ./plugins/video-player/frontend/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ==========================================
# builder: ソースコピー → ビルド
# ==========================================
FROM deps AS builder
WORKDIR /app

COPY . .

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

ARG NEXT_PUBLIC_COMMIT_HASH=unknown
ENV NEXT_PUBLIC_COMMIT_HASH=${NEXT_PUBLIC_COMMIT_HASH}

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

# Next.js ビルドキャッシュを永続化してリビルドを高速化
RUN --mount=type=cache,id=nextjs-cache,target=/app/packages/frontend/.next/cache \
    pnpm run build

# inject-workspace-packages=true: pnpm deploy がシンボリックリンクではなく実ファイルをコピーする
RUN echo "inject-workspace-packages=true" > .npmrc \
    && pnpm --filter="@ubichill/backend" --prod deploy --ignore-scripts /app/deploy-backend \
    && pnpm --filter="@ubichill/frontend" --prod deploy --ignore-scripts /app/deploy-frontend \
    && cp packages/frontend/.next/standalone/packages/frontend/server.js /app/deploy-frontend/server.js \
    && cp -r packages/frontend/.next/server /app/deploy-frontend/.next/ \
    && find packages/frontend/.next -maxdepth 1 -type f -exec cp {} /app/deploy-frontend/.next/ \; \
    && cp -r packages/frontend/.next/static /app/deploy-frontend/.next/ \
    && cp -r packages/frontend/public /app/deploy-frontend/public

# ==========================================
# backend-runner
# ==========================================
FROM node:${NODE_VERSION}-alpine AS backend-runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

USER node
COPY --from=builder --chown=node:node /app/deploy-backend .

EXPOSE 3001
CMD ["node", "dist/index.js"]

# ==========================================
# frontend-runner
# ==========================================
FROM node:${NODE_VERSION}-alpine AS frontend-runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

ARG NEXT_PUBLIC_COMMIT_HASH=unknown
ENV NEXT_PUBLIC_COMMIT_HASH=${NEXT_PUBLIC_COMMIT_HASH}

USER node
COPY --from=builder --chown=node:node /app/deploy-frontend .

EXPOSE 3000
CMD ["node", "server.js"]
