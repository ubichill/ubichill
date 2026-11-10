# backend の地図

層は 3 つ: `routes/`（HTTP の形だけ）→ `services/`（業務の流れ。`createX(deps)` が流れ、`xService.ts` が DB・連合につないだ実体）→
shared（`@ubichill/shared` の純粋な規則。画面と同じ関数）。DB は `@ubichill/db` の repository。

| 機能 | routes | services | 規則（shared） |
|---|---|---|---|
| 登録・OTP・名前の確認 | `users/registration.ts` | `lib/auth.ts`・`users/displayName.ts` | `user/handle.ts`・`user/displayNameChange.ts` |
| 自分のアカウント（/me・パスワード・表示名） | `users/account.ts` | `users/displayName.ts`・`users/publicProfile.ts` | `user/displayNameChange.ts` |
| プロフィールの編集・画像 | `profiles.ts`（`profilesRouter.ts`） | `profiles/` | `user/profile.ts` |
| 公開環境（署名鍵） | `users/publishingEnvironments.ts` | `authors/publishingEnvironmentService.ts` | `user/signingKeys.ts` |
| 作ったワールド・外部の作品 | `users/works.ts`・`worlds.ts` | `worlds/myWorlds.ts`・`worlds/externalWorkRegistration.ts`・`worlds/worldRegistry.ts` | `world/` |
| お気に入り | `users/favorites.ts` | `worlds/favoriteService.ts` | `user/favoritesVisibility.ts` |
| プライバシー（オンライン状態） | `users/privacy.ts` | — | `user/presence.ts` |
| ほかの人に見せる情報（プロフィール・作品・お気に入り） | `users/public.ts` | `users/publicProfile.ts`・`worlds/publishedWorks.ts` | `user/profile.ts` |
| ホーム | `home.ts` | `instances/homeInstance.ts` | `user/home.ts` |
| 人を探す・引く | `social/people.ts` | `social/people.ts` | `user/userSearch.ts` |
| 相手との関係（フレンド・ブロック・フォロー） | — | `social/relations.ts`（集め役） | `user/friends.ts`・`user/blocks.ts` |
| フレンド | `social/friends.ts` | `social/friendships.ts` | `user/friends.ts` |
| ブロック | `social/blocks.ts` | `social/blocks.ts`・`social/blockCheck.ts` | `user/blocks.ts`（`interactionRefusal`） |
| フレンドの現在地 | `social/index.ts` | `social/friendLocations.ts` | `user/friends.ts`・`user/instanceAccess.ts` |
| 招待・リクエストインバイト | `invites.ts` | `social/invites.ts` | `user/instanceAccess.ts` |
| メッセージ | `messages.ts` | `social/messages.ts` | `user/messages.ts` |
| 通知 | `notifications.ts` | `notifications/` | `notification/` |
| インスタンス（部屋） | `instances.ts` | `instances/` | `user/instanceAccess.ts` |
| ロール・コントロールパネル | `admin.ts` | `roles/` | `user/roles.ts` |
| 連合: ubichill どうし（来訪・現在地・フレンド・招待・部屋 RPC） | `federation/rpc.ts` | `federation/ubichill/` | `federation/ubichill/` |
| 連合: Misskey・Mastodon（フォロー・固定ノート） | `fediverse.ts` | `federation/fediverse/` | `federation/fediverse/` |
| 連合: 共通の土台（署名・鍵・actor・inbox・配送・ドメインの方針） | `federation/`・`webfinger.ts` | `federation/transport/`（直下は配線 `index.ts`・設定・`identity.ts`） | `federation/` 直下 |
| サービストークン・CLI | `serviceTokens.ts`・`cliAuth.ts` | `auth/` | `user/cliAuth.ts` |

- やり取り（申請・承認・招待・メッセージ・フォロー・通知）を止める共通の前提は shared の `interactionRefusal`（自分自身・ブロック）。
  種類ごとの条件は `inviteRefusal`・`inviteRequestRefusal`・`messageRefusal`。
- ユーザーごとの回数の制限は `lib/rateLimit.ts` の `perUserLimiter`。システムユーザーは `services/users/systemUser.ts`。
