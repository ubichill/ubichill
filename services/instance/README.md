# Goインスタンスサーバー

インスタンス内の入退室・カーソル・エンティティ・ロック・メディア同期を管理する。
SNSアカウント、Better Auth、PostgreSQL、Redis、Node.jsに依存せず起動できる。
modの実行はブラウザ内のWorkerで行う。

## 単体運用

リポジトリのルートから:

```sh
go -C services/instance run ./cmd/instance \
  --guests --world=examples/empty.json --origins=http://localhost:3000
```

別ターミナルで既存のブラウザUIを起動する（事前に `pnpm install` と `pnpm turbo build --filter=@ubichill/shared`）:

```sh
VITE_INSTANCE_SERVER_URL=http://localhost:3002 pnpm --filter @ubichill/frontend dev
```

`http://localhost:3000/instance/standalone?name=Alice` を開く。ログイン不要で、他のブラウザから入った
ゲストのカーソルが見える。ゲストIDはサーバーが発行し、同じタブでの再接続に保持する。
`VITE_INSTANCE_ID` でルートURLから移動するインスタンスIDを変更できる。
表示用UIとmod配信はフロント側が担当する。
GoサーバーはUIの静的ファイルやmodを配信しない。フロントをビルドして任意の静的ホストから配信すれば、
実行時に必要なバックエンドはGoのみになる。開発用のViteサーバーもSNS backendには依存しない。

`--world` はOpenAPIの `InstanceDefinition` 形式のJSON。初期エンティティはflatten済みの
ComponentInstance配列で、mod完全性lockや環境設定も含む。
既存のWorld as Code YAMLを使うSNS運用では、TypeScript側の既存の検証・解決・flattenを利用する。
単体運用でmodを使う場合は `pnpm build:workers` でフロントの配信物を作り、定義にlockと初期状態を渡す。

Goバイナリだけを配布する場合:

```sh
go -C services/instance build -o ../../dist/ubichill-instance ./cmd/instance
```

Docker（リポジトリルートから）:

```sh
docker build -t ubichill-instance services/instance
docker run --rm -p 3002:3002 \
  -v "$PWD/services/instance/examples:/worlds:ro" ubichill-instance \
  --guests --world=/worlds/empty.json --origins=http://localhost:3000
```

## SNS連携

`pnpm dev` はGoも起動し、その開発セッション用の管理トークンを双方に渡す。
手動起動では、32文字以上のランダムな `INSTANCE_ADMIN_TOKEN` を双方に同じ値で設定する。

- Go: `go -C services/instance run ./cmd/instance --origins=http://localhost:3000`
- SNS: `INSTANCE_RUNTIME_URL=http://127.0.0.1:3002`（管理APIの内部到達先）
- SNS: `INSTANCE_PUBLIC_URL=http://localhost:3002/realtime/v1/ws`（ブラウザの接続先）

SNSが入室条件を検証して初期状態をPUTし、参加チケットを発行する。
フロントは `POST /api/v1/instances/:id/join` でチケットを取得し、Goへ直接接続する。
人数・在席・フレンドの現在地はGoの管理APIから取得する。Goに到達できなければエラーにし、
空室と見なしてDBレコードを削除しない。空室回収はGo側でも在席を再確認してから実行する。

Helmでは専用イメージ（`ghcr.io/ubichill/ubichill-instance`）・Deployment/ServiceでGoを配置し、
WebSocketの `/realtime/v1/ws` だけを直接ルーティングする（管理APIはクラスタ内のみ）。
backendのデプロイや設定変更ではGoを再起動しない（状態がメモリにあるため）。
管理トークンは既定でbackend Secretの `BETTER_AUTH_SECRET` キーを参照する。
専用キーを使う場合は `instanceRuntime.existingSecret` / `instanceRuntime.secretKey` を指定する。
明示したIngressルートに旧 `/socket.io` があれば削除できる。

## 状態と運用上の制約

- 現時点の状態保存はメモリのみ。再起動すると編集状態・在席・再接続情報が失われる。
  SNS側のDBにあるインスタンスは次の入室時にワールド初期状態から復元する。
- HelmのGo Deploymentは1 replica・Recreate。複数サーバーへの割当はまだ実装していない。
  単純にreplica数を増やすと状態が分裂する。
- SNS停止中でも既存のGo接続は継続する。SNS連携での新規入室・再接続はチケット再取得が必要。
- 自動再接続は最大6回・30秒。失効チケットの取り直しも同じ上限内で1回だけ行う。
  単体モードは上限到達後に失敗画面に留まり、本人の操作で再試行する。
- SNSのフレンド解除やBANを既存接続へ即時反映する機能はない。
- 公開運用ではTLSをIngress等で終端し、`--origins` を実際のフロントURLへ設定する。

通信・制限・再同期の詳細は [プロトコル](../../protocol/instance/README.md)。

## 開発

```sh
pnpm protocol:generate
go -C services/instance test -race ./...
go -C services/instance vet ./...
```

HTTP型はOpenAPIからGo/TypeScript双方に生成する。WebSocketのイベント型は既存のsharedの型を利用し、
AsyncAPIで接続とフレームを記述する。ドメイン操作・再接続・ロック等は手書き実装。
