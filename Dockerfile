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
COPY packages/bff/package.json            ./packages/bff/package.json
COPY packages/db/package.json             ./packages/db/package.json
COPY packages/ecs/package.json            ./packages/ecs/package.json
COPY packages/frontend/package.json       ./packages/frontend/package.json
COPY packages/react/package.json          ./packages/react/package.json
COPY packages/sandbox/package.json        ./packages/sandbox/package.json
COPY packages/sdk/package.json            ./packages/sdk/package.json
COPY packages/shared/package.json         ./packages/shared/package.json
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

# 環境名（dev/prod の判定用）。未指定時は production 扱いにして、
# 本番でうっかりバージョンバッジが出ないよう安全側に倒す。
ARG VITE_ENVIRONMENT=production
ENV VITE_ENVIRONMENT=${VITE_ENVIRONMENT}

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

RUN pnpm run build

# inject-workspace-packages=true: pnpm deploy がシンボリックリンクではなく実ファイルをコピーする
RUN echo "inject-workspace-packages=true" > .npmrc \
    && pnpm --filter="@ubichill/backend" --prod deploy --ignore-scripts /app/deploy-backend \
    && pnpm --filter="@ubichill/bff" --prod deploy --ignore-scripts /app/deploy-bff

# ==========================================
# backend-runner: Express API サーバー
# ==========================================
FROM node:${NODE_VERSION}-alpine AS backend-runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=${COMMIT_HASH}

USER node
COPY --from=builder --chown=node:node /app/deploy-backend .
COPY --from=builder --chown=node:node /app/worlds ./worlds

# コンテナ内の絶対パス。k8s で ConfigMap/PVC をマウントする場合は WORLDS_DIR で上書きする
ENV WORLDS_DIR=/app/worlds

EXPOSE 3001
CMD ["node", "dist/index.js"]

# ==========================================
# frontend-runner: BFF（Node/Express）で SPA を配信
#
# 静的配信に加え、/world/:id で core API から取得したワールド情報を index.html の
# <head> に OGP/JSON-LD として注入する（Web 検索・SNS リンクプレビュー対応）。
# core backend はドメイン API に純化し、/api・/socket.io は Ingress が直接ルーティングする。
# ==========================================
FROM node:${NODE_VERSION}-alpine AS frontend-runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production

USER node
COPY --from=builder --chown=node:node /app/deploy-bff .
COPY --from=builder --chown=node:node /app/packages/frontend/dist ./frontend-dist

# BFF が配信する SPA の場所。core API の内部到達先は CORE_API_URL（compose/K8s で設定）。
ENV FRONTEND_DIST=/app/frontend-dist
ENV PORT=3000
ENV CORE_API_URL=http://backend:3001

EXPOSE 3000
CMD ["node", "dist/index.js"]
