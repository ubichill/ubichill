# backend の地図

層は 3 つ: `routes/`（HTTP の形だけ）→ `services/`（業務の流れ）→
shared（`@ubichill/shared` の純粋な規則。画面と同じ関数）。DB は `@ubichill/db` の repository。

## 層の規則

人も AI も、新しく書くときはこれに従う。`pnpm check:architecture`（CI の lint の後）が機械的に確かめるものには規則の ID を付けた。

1. **routes・middleware は `@ubichill/db` を値で import しない**（`import type` だけはよい。`backend-http-has-no-db`）。
   route がするのは、入力の検査・認証の確認・service の結果を状態コードと JSON にすることだけ。DB を 1 回引くだけでも service を呼ぶ
   （読むだけなら `services/users/userService.ts` のような薄い窓口でよい）。
   - 理由: route に手順を書くと、別の route が同じ手順を書き写して、一意制約・キャッシュの破棄・通知の扱いがずれる
     （`cliAuth.ts` の `/token` が公開環境の登録を書き写し、同時の登録で 500 になり、取り消しのあとのキャッシュの破棄も各所に散っていた）。
     route の中の手順は単体テストもできない。
2. **配線（本物の repository を service に渡す）は services の `<単数>Service.ts` に置く**。route の `index.ts` は limiter・認証・service を
   `createXRouter(deps)` に渡すだけ。
3. **手順は `<機能>.ts` の `createX(deps)` に書き、deps は使う側が要る分だけ宣言する**（repository の型をまるごと受け取らない。
   形が合えば repository をそのまま渡せる）。テストは deps に配列などで作った偽物を渡し、同時の操作・途中の失敗・消えた相手などの意地悪な場合を書く。
   規則の無い読み書きだけの service（`userService.ts`・`privacyService.ts`）は `createX` にせず repository を直接呼んでよい。
4. **同じデータを書く手順は 1 か所**。書いたあとに後始末（キャッシュの破棄・通知・連合への配送）が要るものは特に。
   公開環境（作者の署名鍵）を足す・取り消すのは `services/authors/publishingEnvironments.ts` だけ（`author-key-writes-in-one-place`）。
5. **DB のエラー（一意制約違反など）を見分けるのは repository**。service にはエラーの番号ではなく `undefined` や結果の型で返す
   （例: `authorKeyRepository.createLocal` は同じ鍵がもうあれば `undefined`）。
   残っている例外は `worldRegistry.saveBundle` の `isUniqueViolation`（直すときは `worldRepository` が衝突を結果の型で返すようにする）。
6. **1 つのトランザクションでまとめたい読み書きは、repository の `locked(...)`・`with...Lock(...)` に閉じ込める**。
   repository がトランザクションとロック（`pg_advisory_xact_lock` か `FOR UPDATE`）を取り、そのトランザクションでできる操作だけを
   コールバックに渡す。service に `tx` を渡さない。コールバックの中で別の接続を使わない（接続を使い切ると全員が止まる）。
   外への通信（連合）が混ざってトランザクションにできない手順は、先に書く行と、やり直せば済む順番で組む（例 `social/blocks/blocks.ts`）。
7. service は失敗を `{ ok: false, status, error, code? }` で返してよい（状態コードを決めるのは service で、route はそのまま返す）。
   全体でこの形にそろえているので、1 か所だけ別の形に変えない。

## ファイルの名前の規約

- route: 機能ごとのディレクトリにし、`router.ts` が `createXRouter(deps)`（テストは `router.test.ts`）、`index.ts` が実体をつないだ `router`。
  1 つのディレクトリに複数の面がある `users/`・`social/` は、面ごとのファイルを `index.ts` がつなぐ。小さいもの（`worlds.ts` など）は 1 ファイルのまま。
- service: 規則は `<機能>.ts` の `createX(deps)`（テスト付き・DB を知らない）、DB・連合・通知につないだ実体は `<単数>Service.ts`（例 `blocks.ts` と `blockService.ts`）。
  使う route が 1 つだけでも、実体は services に置く（`profiles/profileService.ts`・`instances/homeService.ts`）。連合は大きいので配線を `federation/index.ts` に置く。
  1 つのディレクトリに機能が並ぶときは、機能ごとのディレクトリにまとめる（`social/blocks/`・`social/friends/` など）。

| 機能 | routes | services | 規則（shared） |
|---|---|---|---|
| 登録・OTP・名前の確認 | `users/registration.ts` | `lib/auth.ts`・`users/displayName.ts` | `account/handle.ts`・`account/displayNameChange.ts` |
| 自分のアカウント（/me・パスワード・表示名） | `users/account.ts` | `users/userService.ts`・`users/displayName.ts`・`users/publicProfile.ts` | `account/displayNameChange.ts` |
| プロフィールの編集・画像 | `profiles/` | `profiles/`（実体は `profileService.ts`） | `account/profile.ts` |
| 公開環境（署名鍵）・署名の作者の確認・API トークンの認証 | `users/publishingEnvironments.ts`・`authors.ts`・`middleware/auth.ts` | `authors/publishingEnvironments.ts`（実体は `publishingEnvironmentService.ts`） | `publishing/signingKeys.ts` |
| 作ったワールド・外部の作品 | `users/works.ts`・`worlds.ts` | `worlds/myWorlds.ts`・`worlds/externalWorkRegistration.ts`・`worlds/worldRegistry.ts` | `world/`・`publishing/externalWorks.ts` |
| お気に入り（ワールド・mod） | `users/favorites.ts` | `worlds/favoriteService.ts`・`mods/modFavorites.ts`（実体は `modFavoriteService.ts`、引き方は `modLookup.ts`） | `account/favoritesVisibility.ts`・`mod/favorites.ts` |
| プライバシー（オンライン状態） | `users/privacy.ts` | `users/privacyService.ts` | `social/presence.ts` |
| ほかの人に見せる情報（プロフィール・作品・お気に入り） | `users/public.ts` | `users/userService.ts`・`users/publicProfile.ts`・`worlds/publishedWorks.ts` | `account/profile.ts` |
| ホーム | `home/` | `instances/homeInstance.ts`（実体は `homeService.ts`） | `account/home.ts` |
| 人を探す・引く | `social/people.ts` | `social/people.ts` | `social/userSearch.ts` |
| 相手との関係（フレンド・ブロック・フォロー） | — | `social/relations.ts`（集め役）・`social/userSummaries.ts` | `social/friends.ts`・`social/blocks.ts` |
| フレンド | `social/friends.ts` | `social/friends/` | `social/friends.ts` |
| ブロック | `social/blocks.ts` | `social/blocks/`（有無を引くだけなら `blockCheck.ts`） | `social/blocks.ts`（`interactionRefusal`） |
| フレンドの現在地 | `social/index.ts` | `social/friends/friendLocations.ts` | `social/friends.ts`・`social/instanceAccess.ts` |
| 招待・リクエストインバイト | `invites/` | `social/invites/` | `social/instanceAccess.ts` |
| メッセージ | `messages/` | `social/messages/` | `social/messages.ts` |
| 通知 | `notifications.ts` | `notifications/` | `notification/` |
| インスタンス（部屋） | `instances.ts` | `instances/` | `social/instanceAccess.ts` |
| ロール・コントロールパネル | `admin/` | `roles/` | `account/roles.ts` |
| 連合: ubichill どうし（来訪・現在地・フレンド・招待・部屋 RPC） | `federation/rpc.ts` | `federation/ubichill/` | `federation/ubichill/` |
| 連合: Misskey・Mastodon（フォロー・固定ノート・設定とフォロワーの画面） | `fediverse.ts` | `federation/fediverse/`（画面は `fediverseAccount.ts`） | `federation/fediverse/` |
| 連合: 共通の土台（署名・鍵・actor・inbox・配送・ドメインの方針） | `federation/`・`webfinger.ts` | `federation/transport/`（直下は配線 `index.ts`（管理者の `domainPolicyAdmin` も）・設定・`identity.ts`） | `federation/` 直下 |
| サービストークン・CLI | `serviceTokens.ts`・`cliAuth.ts` | `auth/`（CLI の認可は `cliAuth.ts`、実体は `cliAuthService.ts`） | `publishing/cliAuth.ts` |

- やり取り（申請・承認・招待・メッセージ・フォロー・通知）を止める共通の前提は shared の `interactionRefusal`（自分自身・ブロック）。
  種類ごとの条件は `inviteRefusal`・`inviteRequestRefusal`・`messageRefusal`。
- ユーザーごとの回数の制限は `lib/rateLimit.ts` の `perUserLimiter`（IP・任意のキーごとは `sharedLimiter`）。システムユーザーは `services/users/systemUser.ts`。
