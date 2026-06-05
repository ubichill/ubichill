<p align="center">
  <img src="docs/image.png" alt="Ubichill" width="720" />
</p>

<h1 align="center">Ubichill</h1>

<p align="center">
  <strong>みんなのカーソルが集まって、描いたり、観たり、いっしょに過ごす Web スペース。</strong><br />
  URL を開くだけ。インストール不要、アカウントは任意。
</p>

<p align="center">
  <a href="https://ubichill.youkan.uk/"><strong>ubichill.youkan.uk</strong></a>
</p>

<p align="center">
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ・
  <a href="docs/WORLD_AS_CODE.md">World as Code</a>
  ・
  <a href="docs/API.md">API</a>
  ・
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

---

## Ubichill とは

URL を開くだけでカーソルがアバターになる、軽量な 2D メタバース。
ペン・動画・付箋など、世界の機能は **動的にロードされる Web Worker プラグイン** で増やせる。

- **動的にロードされるプラグイン** — ゼロトラスト Worker サンドボックスで安全に実行
- **完全 CSR + Socket.IO** — サーバーは状態同期だけ、UI はブラウザに閉じる
- **World as Code** — YAML でワールド定義をプロビジョニング、エディタで編集

## 環境

| 環境 | URL | 反映トリガー |
|---|---|---|
| Production | <https://ubichill.youkan.uk/> | `main` への merge → `latest` タグで自動デプロイ |
| Dev (PR preview) | <https://ubichill-dev.youkan.uk/> | `main` 向け PR の push → `dev` ブランチ経由で自動デプロイ |

## 自分のサーバーで動かす

```bash
helm repo add ubichill https://ubichill.github.io/ubichill
helm install ubichill ubichill/ubichill -n ubichill --create-namespace \
  --set postgresql.auth.password=<set-a-password> \
  --set backend.secretEnv.BETTER_AUTH_SECRET=<random-secret>
```

詳細は [Helm Chart README](charts/ubichill/README.md) と [Troubleshooting](docs/Troubleshooting.md)。

## ローカル開発

```bash
pnpm install
pnpm dev          # PostgreSQL (Docker) + Backend (3001) + Frontend (3000)
```

PR フローは [.github/workflows/ci.yml](.github/workflows/ci.yml)、内部設計は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## コントリビュート

Issue / PR 歓迎。公式プラグインだけ作る、もウェルカム。
PR は日本語でできればお願いします。

## ライセンス

TBD
