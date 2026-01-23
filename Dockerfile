FROM node:18-alpine AS base

# pnpmの設定
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# 依存関係のコピーとインストール
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY package.json ./

# 各パッケージのpackage.jsonをコピー (依存関係解決のため)
# ディレクトリ構造を維持してコピーする必要がある
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/frontend/panda.config.ts ./packages/frontend/

# 依存関係のインストール
RUN pnpm install --frozen-lockfile

# ソースコードのコピー
COPY . .

# 実行ステージ (Backend)
FROM base AS backend-runner
WORKDIR /app
RUN pnpm --filter "@ubichill/backend..." build
EXPOSE 3001
CMD ["pnpm", "--filter", "backend", "start"]

# 実行ステージ (Frontend)
FROM base AS frontend-runner
WORKDIR /app
RUN pnpm --filter "@ubichill/frontend..." build
EXPOSE 3000
CMD ["pnpm", "--filter", "frontend", "start"]
