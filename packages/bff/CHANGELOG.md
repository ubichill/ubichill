# @ubichill/bff

## 1.0.17

### Patch Changes

- 8c6176a: 画面と API のビルドコミットが異なる場合に更新通知が再表示される問題を修正。SNS 画面に同梱する版情報をキャッシュさせずに配信し、単独ワールドの配布物には追加しない。

## 1.0.16

### Patch Changes

- Updated dependencies [6ba0785]
- Updated dependencies [787dfc4]
- Updated dependencies [4424709]
  - @ubichill/shared@1.14.0

## 1.0.15

### Patch Changes

- d6764be: 作者がユーザーページに登録した外部のワールド（GitHub Pages など）を、短い共有 URL（`/@handle/name`）で開けるようにした。開けるのは、その作者の署名でそのワールドだと確かめられたときだけ。`/world?url=…` で開いた場合も、そうなら短い共有 URL に置き換え、共有リンクにもそれを使う。
- 890dd1d: ユーザーページを SNS のプロフィールの形にし、本人はその場で編集できるようにした。

  - プロフィールに、ひとこと（1 行・60 文字）・バナー画像・リンク（https だけ・最大 5 件。ホスト名で GitHub・X・YouTube・Bluesky・Twitch・pixiv・BOOTH・VRChat を見分ける）・話せる言語（決まった一覧から最大 5 件）を足した。規則は shared にあり、画面と API で同じものを使う。
  - アイコンとバナーはアップロードする。サーバーが sharp で作り直し（EXIF の向きを反映してメタデータを全部消す・アイコン 512×512 / バナー 1500×500 の WebP）、中身は DB（`profile_images`）に置く。配信は内容のハッシュ入りの URL（`/api/v1/users/:id/images/:kind/:hash.webp`）で、immutable で長く cache させる。
  - API: `PUT /api/v1/users/me/profile`、`PUT` / `DELETE /api/v1/users/me/images/:kind`。公開プロフィール（`/api/v1/users/:id`・`/api/v1/social/users/by-handle/:handle` など）に新しい項目を足した。
  - DB: `user_profiles`・`profile_images` を足す（0027。users は変えない）。
  - backend のイメージ: alpine で sharp を読み込めるよう、musl 用のネイティブ部分を入れる。
  - リンクのプレビュー（`/@ID`）: 自己紹介が無ければひとことを説明に使い、アイコンが無ければバナーを大きく出す。

- Updated dependencies [d6764be]
- Updated dependencies [890dd1d]
  - @ubichill/shared@1.13.0

## 1.0.14

### Patch Changes

- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [abbb4db]
- Updated dependencies [04d9050]
- Updated dependencies [04d9050]
  - @ubichill/shared@1.12.0

## 1.0.13

### Patch Changes

- Updated dependencies [24578ca]
- Updated dependencies [b4c63fa]
- Updated dependencies [24578ca]
  - @ubichill/shared@1.11.0

## 1.0.12

### Patch Changes

- Updated dependencies [d7850d7]
  - @ubichill/shared@1.10.0

## 1.0.11

### Patch Changes

- Updated dependencies [70b6047]
- Updated dependencies [c0164c3]
- Updated dependencies [db4057f]
- Updated dependencies [319eb74]
- Updated dependencies [f942349]
- Updated dependencies [4afeacc]
- Updated dependencies [0030710]
- Updated dependencies [ac490dd]
  - @ubichill/shared@1.9.1

## 1.0.10

### Patch Changes

- Updated dependencies [902a24c]
- Updated dependencies [a5d6f3a]
- Updated dependencies [9d7c2d9]
- Updated dependencies [18142c5]
- Updated dependencies [b802a3c]
  - @ubichill/shared@1.9.0

## 1.0.9

### Patch Changes

- Updated dependencies [c6cba3a]
  - @ubichill/shared@1.8.0

## 1.0.8

### Patch Changes

- 5d131c6: mod が同梱 WASM とバイナリを扱える基盤を追加（`Ubi.asset`、`Ubi.fetch` の `responseType: 'arrayBuffer'`・`maxBytes`・`timeoutMs`・`signal`、`Ubi.runtime`、manifest の `assetIntegrity`）。Sandbox Worker の封鎖をプロトタイプチェーンの全段に広げ、Worker 専用の CSP（スクリプトの URL を許可しない）を配信するよう修正。`Ubi.fetch` はリダイレクトを追わず（`FETCH_REDIRECT_BLOCKED`）、取り消した依頼の承認画面は取り下げる（`self` の上書きだけでは `Object.getPrototypeOf(self).fetch` で本体 API に届いていた）。プロトコル v4。
- Updated dependencies [70ae199]
- Updated dependencies [5d131c6]
- Updated dependencies [1e313e9]
  - @ubichill/shared@1.7.0

## 1.0.7

### Patch Changes

- Updated dependencies [749cc83]
  - @ubichill/shared@1.6.0

## 1.0.6

### Patch Changes

- Updated dependencies [307340c]
  - @ubichill/shared@1.5.0

## 1.0.5

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
