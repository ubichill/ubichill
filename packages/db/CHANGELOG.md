# @ubichill/db

## 1.3.0

### Minor Changes

- 70ae199: 表示名を別の名前に変えるのを 90 日に 1 回までにする（大文字小文字・全角半角だけの変更と、重複の解消は除く）。ユーザー検索は表示名の一意キーで照合して ID の一致を先に並べ、`@ID@サーバー` の指定を解釈する（ほかのサーバーのアカウントは `remoteAccount` として返す）。

### Patch Changes

- Updated dependencies [70ae199]
- Updated dependencies [5d131c6]
- Updated dependencies [1e313e9]
  - @ubichill/shared@1.7.0

## 1.2.1

### Patch Changes

- Updated dependencies [749cc83]
  - @ubichill/shared@1.6.0

## 1.2.0

### Minor Changes

- 307340c: フレンド・ソーシャルとインスタンスの公開範囲を追加し、通信が切れたあとにインスタンスが消える問題を直す。

  - フレンドの申請・承認・解除と、ユーザー検索（ID の前方一致・表示名の部分一致）。API は `/api/v1/social`
  - フレンドの現在地（インスタンスごと。見えないインスタンスにいるフレンドは「非公開の場所」）
  - インスタンスの公開範囲（パブリック・フレンド+・フレンドのみ・招待のみ）を一覧・詳細・参加で効かせる。作成時に選べる
  - 自動で再接続したら参加し直す（以前は参加し直さず、猶予の後に退出扱いになって空のインスタンスが削除されていた）
  - 同じアカウントが別のタブで参加したら、古いタブに理由を知らせてから切る
  - ユーザーページをログインなしで見られるようにし、自己紹介（本人が書く）とリンクのプレビュー（名前・アイコン・説明）を付ける

### Patch Changes

- Updated dependencies [307340c]
  - @ubichill/shared@1.5.0

## 1.1.0

### Minor Changes

- 0d3bd18: ワールドの公開を 1 つの形・規則・方法にまとめる。本体の DB・リポジトリ（worlds/）・外部ホストのワールドを区別しない。

  - どのワールドも「定義・lock・署名」の組で、同じ規則で検証する。本体のワールドで署名が壊れていても、未署名に格下げせず拒否する
  - 本体は中身を書き換えない（metadata.name も）。同じワールドかは作者 + metadata.name で決まる。本体へ送る入口は `PUT /api/v1/worlds` だけ
  - `ubichill publish` は手元で署名した組をそのまま送る。prepare と `<world>.ubichill.json` は不要になった
  - 配り方も 1 つ: 本体のワールド（DB・リポジトリとも）は `/api/v1/worlds/<id>.yaml` と兄弟の `.lock.json` / `.sig.json` で、外部ホストと同じ形。以前の URL・共有 URL は `.yaml` に正規化し、保存済みのお気に入り・インスタンスの参照も書き換える
  - `worlds/trusted-authors.json` による特別な信用をやめた。公式アカウントの鍵もほかの作者と同じく WebFinger で確かめ、画面から取り消せる
  - lock に固定されていない mod は、配信場所に関係なく実行しない
  - リポジトリ（worlds/）のワールドは、作者がこのサーバーのアカウントのものだけ配る。ほかのサーバーの作者のワールドは写しを配らず、公式アカウントがプロフィールの「連合」でそのサーバーをフォローして一覧に出す（例: https://ubichill.com）
  - 使われていなかった `WORLDS_REGISTRY_URLS` とレジストリの列挙を削除
  - 共有 URL は `/@ID/名前`、配信は `/api/v1/authors/ID/worlds/名前.yaml`（作者と名前で決まり、ほかのサーバーも URL だけでたどれる）。保存には ID が要る
  - 名前（metadata.name）の変更は移動: 同じワールドのまま URL が変わり、以前の URL からもたどれる。エディタのワールド情報に名前の欄を追加
  - 公式ワールドの署名は、ほかの作者と同じく CI（公式アカウントの CI 用公開環境、Secret UBICHILL_CREDENTIALS）で main に入ったときに行う。署名ファイルはコミットしない（`pnpm sign:worlds` を廃止）
  - `ubichill publish` は複数のワールドをまとめて公開・書き出しでき、共有 URL を表示する

### Patch Changes

- Updated dependencies [0d3bd18]
  - @ubichill/shared@1.4.0

## 1.0.4

### Patch Changes

- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
- Updated dependencies [25e2070]
  - @ubichill/shared@1.3.0

## 1.0.3

### Patch Changes

- Updated dependencies [c764ea4]
  - @ubichill/shared@1.2.0

## 1.0.2

### Patch Changes

- Updated dependencies [988f2c8]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
  - @ubichill/shared@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
  - @ubichill/shared@1.0.1
