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

# Vite ビルド時に埋め込まれる環境変数
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

ARG VITE_COMMIT_HASH=unknown
ENV VITE_COMMIT_HASH=${VITE_COMMIT_HASH}

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

RUN pnpm run build

# inject-workspace-packages=true: pnpm deploy がシンボリックリンクではなく実ファイルをコピーする
RUN echo "inject-workspace-packages=true" > .npmrc \
    && pnpm --filter="@ubichill/backend" --prod deploy --ignore-scripts /app/deploy-backend

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
# frontend-runner: Vite 静的ファイルを nginx で配信
# ==========================================
FROM nginx:stable-alpine AS frontend-runner

# SPA ルーティング: すべてのパスを index.html にフォールバック
RUN printf 'server {\n\
    listen 3000;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
