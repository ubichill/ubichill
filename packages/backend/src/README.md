# backend の地図

層は 3 つ: `routes/`（HTTP の形だけ）→ `services/`（業務の流れ）→
shared（`@ubichill/shared` の純粋な規則。画面と同じ関数）。DB は `@ubichill/db` の repository。

## ファイルの名前の規約

- route: 機能ごとのディレクトリにし、`router.ts` が `createXRouter(deps)`（テストは `router.test.ts`）、`index.ts` が実体をつないだ `router`。
  1 つのディレクトリに複数の面がある `users/`・`social/` は、面ごとのファイルを `index.ts` がつなぐ。小さいもの（`worlds.ts` など）は 1 ファイルのまま。
- service: 規則は `<機能>.ts` の `createX(deps)`（テスト付き・DB を知らない）、DB・連合・通知につないだ実体は `<単数>Service.ts`（例 `blocks.ts` と `blockService.ts`）。
  使う route が 1 つだけなら、実体は route の `index.ts` で組み立ててよい（`profiles/`・`home/`）。連合は大きいので配線を `federation/index.ts` に置く。
  1 つのディレクトリに機能が並ぶときは、機能ごとのディレクトリにまとめる（`social/blocks/`・`social/friends/` など）。

| 機能 | routes | services | 規則（shared） |
|---|---|---|---|
| 登録・OTP・名前の確認 | `users/registration.ts` | `lib/auth.ts`・`users/displayName.ts` | `account/handle.ts`・`account/displayNameChange.ts` |
| 自分のアカウント（/me・パスワード・表示名） | `users/account.ts` | `users/displayName.ts`・`users/publicProfile.ts` | `account/displayNameChange.ts` |
| プロフィールの編集・画像 | `profiles/` | `profiles/` | `account/profile.ts` |
| 公開環境（署名鍵） | `users/publishingEnvironments.ts` | `authors/publishingEnvironmentService.ts` | `publishing/signingKeys.ts` |
| 作ったワールド・外部の作品 | `users/works.ts`・`worlds.ts` | `worlds/myWorlds.ts`・`worlds/externalWorkRegistration.ts`・`worlds/worldRegistry.ts` | `world/`・`publishing/externalWorks.ts` |
| お気に入り | `users/favorites.ts` | `worlds/favoriteService.ts` | `account/favoritesVisibility.ts` |
| プライバシー（オンライン状態） | `users/privacy.ts` | — | `social/presence.ts` |
| ほかの人に見せる情報（プロフィール・作品・お気に入り） | `users/public.ts` | `users/publicProfile.ts`・`worlds/publishedWorks.ts` | `account/profile.ts` |
| ホーム | `home/` | `instances/homeInstance.ts` | `account/home.ts` |
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
| 連合: Misskey・Mastodon（フォロー・固定ノート） | `fediverse.ts` | `federation/fediverse/` | `federation/fediverse/` |
| 連合: 共通の土台（署名・鍵・actor・inbox・配送・ドメインの方針） | `federation/`・`webfinger.ts` | `federation/transport/`（直下は配線 `index.ts`・設定・`identity.ts`） | `federation/` 直下 |
| サービストークン・CLI | `serviceTokens.ts`・`cliAuth.ts` | `auth/` | `publishing/cliAuth.ts` |

- やり取り（申請・承認・招待・メッセージ・フォロー・通知）を止める共通の前提は shared の `interactionRefusal`（自分自身・ブロック）。
  種類ごとの条件は `inviteRefusal`・`inviteRequestRefusal`・`messageRefusal`。
- ユーザーごとの回数の制限は `lib/rateLimit.ts` の `perUserLimiter`。システムユーザーは `services/users/systemUser.ts`。
