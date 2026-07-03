# コントリビューションガイド

Ubichill への貢献ありがとうございます。バグ報告・提案は Issue、変更は Pull Request で歓迎します。

## 開発環境

- 必要: Node（バージョンは `package.json` の `volta` を参照）/ pnpm / Docker
- セットアップ: `pnpm install`
- 開発サーバー（Docker 含む）: `pnpm dev`
- プラグイン Worker のバンドル: `pnpm build:workers`
- Lint（**コミット前に必須**）: `pnpm lint` / 自動整形 `pnpm lint:fix`
- 型チェック: `pnpm typecheck`

## コーディング規約（抜粋 — 詳細は [CLAUDE.md](CLAUDE.md)）

- **named export のみ**。default export と `any` 型は禁止。
- スタイリング: Host 本体（`packages/frontend`）は **PandaCSS** のみ。`style` ではなく
  `className`、色は `tokens.colors` を使う（ハードコード禁止）。レイアウトは `css()`、
  共通部品は `cva()`。
- **UI に絵文字を使わない**（アイコンは SVG）。
- 関数型・宣言的に書く（`let` を避け純粋関数で処理）。
- 責務分離を徹底し、神クラス/関数を作らない。
- プラグインは **`@ubichill/sdk` のみに依存**する（Host / 本体との直接結合は禁止）。
- パッケージ責務: `@ubichill/engine`(純 ECS) / `@ubichill/sandbox`(隔離実行) /
  `@ubichill/react`(Host Hooks) / `@ubichill/sdk`(プラグイン API)。

## ブランチ / コミット / PR

- `main` から作業ブランチを切る（例: `feat/...`, `fix/...`, `chore/...`）。
- コミットメッセージ・PR は**日本語**で、[Conventional Commits](https://www.conventionalcommits.org/)
  （`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` など）に従う。
- CI（lint / typecheck）を通すこと。
- レビューを受けてマージ（squash merge 推奨）。

### プレビュー環境

メンテナが PR に **`preview` ラベル**を付けると、CI が PR ごとの immutable イメージ
（`:pr-<番号>` / `:sha-<sha>`）をビルドし、GitOps（ArgoCD ApplicationSet）が
`pr-<番号>.ubichill.com` にプレビューを払い出します。外部フォークの未検証コードを
勝手にデプロイしないため、ラベルはメンテナが付与します。

## ライセンス / 貢献の同意

本プロジェクトは **AGPL-3.0**（コアアプリケーション）＋**プラグイン例外**で配布されます
（[COPYING](COPYING) / [LICENSE](LICENSE) 参照）。Pull Request を提出することで、あなたの貢献が
同ライセンスの下で配布されることに同意したものとみなします。

## 行動規範

参加者は [行動規範](CODE_OF_CONDUCT.md) に従ってください。
