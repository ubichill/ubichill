---
description: AIアシスタント向けガイドライン
---
# AI アシスタント向けガイドライン (AI_INSTRUCTIONS)

このドキュメントは、このリポジトリ (Ubichill) を操作するAIエージェント向けの指示書です。
コードを生成または修正する際は、以下のルールを遵守してください。

## 1. プロジェクト構造とパッケージ管理

- **モノリポ構成**: このプロジェクトは `pnpm workspace` を使用しています。
  - ルートの `node_modules` は全パッケージで共有されますが、各 `package.json` に明示的な依存関係が必要です。
  - パッケージ間の依存関係（例: `backend` が `shared` に依存）は `workspace:*` プロトコルを使用してください。
  
- **パッケージの役割**:
  - `packages/shared`: **重要**。型定義、定数、共通ユーティリティはここに記述してください。フロントエンドとバックエンドでコードを重複させないでください。
  - `packages/backend`: APIサーバー、Socket.ioサーバーロジック。
  - `packages/frontend`: UI/UXロジック。`hooks/` にロジックを切り出すことを推奨します。

## 2. 言語とスタイル

- **言語**: TypeScript を使用してください。JavaScriptファイル (`.js`) は設定ファイルを除き作成しないでください。
- **型安全性**: `any` 型の使用は極力避け、`shared` パッケージで型を定義して共有してください。
- **コメント**: 日本語で記述してください。

## 3. Webアプリケーション開発ルール

- **Next.js**: App Router (`src/app`) を使用してください。
- **スタイリング**: **Panda CSS** を使用してください。
  - Tailwind CSSは削除されました。
  - スタイリングは `styled-system` から `css` 関数などをインポートして使用してください。
  - `className` 属性に `css({})` の戻り値を渡す形で記述してください。
- **コンポーネント**: 再利用可能なUIパーツは `src/components` に作成してください。
- **Socket.io**: イベント名は、`shared` パッケージの `ServerToClientEvents` / `ClientToServerEvents` インターフェースで厳密に管理してください。

## 4. Docker / 環境

- **DevContainer**: 開発環境は `.devcontainer` で定義されています。VS Code の "Dev Containers: Reopen in Container" を使用して開発することを推奨します。
  - これにより、Frontend/Backend が統合された環境で開発できます。
- `Dockerfile` (ルート): 本番ビルドおよび GitHub Actions 用です。
- 開発サーバー起動: `pnpm dev` (コンテナ内で実行)

## 5. コマンド

- 全体の開発サーバー起動: `pnpm dev`
- 全体のビルド: `pnpm build`
- 依存関係の追加: `pnpm add <pkg> --filter <workspace-name>` (例: `pnpm add zod --filter frontend`)
