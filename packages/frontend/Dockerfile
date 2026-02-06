FROM node:22-alpine

# pnpmをインストール
RUN npm install -g pnpm@10.28.2

WORKDIR /app

# package.jsonファイルをコピー
COPY package.json pnpm-lock.yaml* ./

# 依存関係をインストール
RUN pnpm install --frozen-lockfile

# アプリケーションファイルをコピー
COPY . .

# Panda CSSを準備
RUN pnpm run prepare:panda

# Next.jsアプリケーションをビルド
RUN pnpm run build

EXPOSE 3000

# 本番環境でNext.jsを起動
CMD ["pnpm", "start"]