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
# frontend-runner: nginx で SPA を配信
#
# try_files で「SPA ルート委譲」と「存在しないアセットの 404」を分離する。
# static-web-server の SERVER_FALLBACK_PAGE と異なり、
# .js/.css 等のファイルが存在しない場合は正しく 404 を返す。
# ==========================================
FROM nginx:alpine AS frontend-runner

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
# テンプレートを配置すると nginx エントリポイントが起動時に envsubst を実行し
# /etc/nginx/conf.d/default.conf を生成する
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# デフォルト値。docker-compose や K8s で上書きする
ENV BACKEND_HOST=backend
ENV BACKEND_PORT=3001

EXPOSE 3000
