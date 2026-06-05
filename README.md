<p align="center">
  <img src="docs/image.png" alt="Ubichill" width="720" />
</p>

<h1 align="center">Ubichill</h1>

<p align="center">
  <strong>みんなのカーソルが集まって、描いたり、観たり、いっしょに過ごす Web スペース。</strong>
</p>

<p align="center">
  URL を開くだけ。インストール不要、アカウントは任意。
</p>

<p align="center">
  <a href="https://ubichill-dev.youkan.uk/"><strong>🎮 触ってみる</strong></a>
  ・
  <a href="docs/ARCHITECTURE.md"><strong>🛠 アーキテクチャ</strong></a>
  ・
  <a href="docs/WORLD_AS_CODE.md"><strong>📐 World as Code</strong></a>
  ・
  <a href="docs/API.md"><strong>📖 API</strong></a>
  ・
  <a href="docs/ROADMAP.md"><strong>🗺 Roadmap</strong></a>
</p>

---

## Ubichill とは

URL を開くだけでカーソルがアバターになる、軽量な 2D メタバース。
ペン・動画・付箋など、世界の機能は **動的にロードされる Web Worker プラグイン** で増やせる。

- 🔌 **プラグインを URL から動的ロード** — ゼロトラスト Worker サンドボックスで安全に実行
- 🌐 **完全 CSR + Socket.IO** — サーバーは状態同期だけ、UI はブラウザに閉じる
- 🧩 **World as Code** — YAML でワールド定義をプロビジョニング、エディタで編集

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

`main` 向けに PR を開くと Dev 環境 (<https://ubichill-dev.youkan.uk/>) に自動デプロイされる。
詳しい開発フローは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) と [.github/workflows/ci.yml](.github/workflows/ci.yml)。

## コントリビュート

Issue / PR 歓迎。プラグインだけ書く・ワールド YAML だけ作る、もウェルカム。
日本語で OK です。

## ライセンス

TBD
