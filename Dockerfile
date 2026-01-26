FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ==========================================
# Builder Stage
# ==========================================
FROM base AS builder
WORKDIR /app

# コピー & インストール
# キャッシュを効かせるため、依存関係定義ファイルのみ先にコピー
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
# Panda CSSの生成に必要な設定ファイルもコピー
COPY packages/frontend/panda.config.ts ./packages/frontend/

RUN pnpm install --frozen-lockfile

# その後ソースコード全体をコピー
COPY . .

# 環境変数設定 (ビルド用)
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# ビルド実行
# Backend: tsc
# Frontend: next build (standalone)
RUN pnpm --filter "@ubichill/backend..." build
RUN pnpm --filter "@ubichill/frontend..." build

# Backend用のデプロイ (prod依存のみ抽出)
RUN pnpm --filter "@ubichill/backend" --prod deploy /out/backend

# ==========================================
# Backend Runner Stage
# ==========================================
FROM base AS backend-runner
WORKDIR /app

# 必要なファイルのみコピー
COPY --from=builder /out/backend .

EXPOSE 3001
CMD ["node", "dist/index.js"]

# ==========================================
# Frontend Runner Stage
# ==========================================
FROM base AS frontend-runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Frontend Static Files & Standalone Server
# 公開ディレクトリ
COPY --from=builder /app/packages/frontend/public ./packages/frontend/public
# 静的ファイル (.next/static)
COPY --from=builder /app/packages/frontend/.next/static ./packages/frontend/.next/static
# Standaloneビルド (必要な依存関係とサーバーコードが含まれる)
COPY --from=builder /app/packages/frontend/.next/standalone ./

EXPOSE 3000
CMD ["node", "packages/frontend/server.js"]
