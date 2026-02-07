FROM python:3.12-slim-bookworm

# 1. 必須ツール（ffmpegは動画処理に必須）
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. uv のインストール（pipより圧倒的に速い）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 3. 作業ディレクトリ
WORKDIR /app

# 4. 依存関係のインストール
# pyproject.toml をコピー
COPY pyproject.toml ./

# 仮想環境を作成してパッケージをインストール
RUN uv venv .venv
ENV PATH="/app/.venv/bin:$PATH"
RUN uv pip install -r pyproject.toml

# 5. アプリケーションコードをコピー
COPY main.py ./

# 6. ポート8000を公開
EXPOSE 8000

# 7. サーバー起動（Python モジュールとして実行）
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]