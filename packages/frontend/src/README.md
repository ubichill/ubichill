# frontend/src の地図

画面の機能 → どこにあるか。判定の規則（何を出すか）は `lib/` の純粋な関数に置いてテストし、`components/` は描くことと副作用（API・画面の移動）の hook に絞る。

## 画面

| 画面（HUD のタブ）| 入口 | 中身 |
| --- | --- | --- |
| ランチパッド・その場 | `components/hud/` | `LaunchpadHome`・`InstanceHUD`・`tabs/InstanceTab`・`tabs/InviteTab` |
| プロフィール（マイページ・`/@ID`）| `tabs/ProfileTab`・`pages/UserPage` | `components/profile/`（表示・編集・バナーの札と操作）。現在地のカードは `social/ProfileLocationCard` |
| ワールド | `tabs/WorldsTab` | `components/worlds/`（一覧・詳細・作ったワールド）、`components/home/`（ホームワールド） |
| ソーシャル | `tabs/SocialTab` | `components/social/`（フレンド・検索・人の表示 `UserIdentity`）、`components/messages/`（会話） |
| 通知 | `tabs/NotificationsTab` | `components/notifications/` |
| 設定 | `tabs/SettingsTab` | `tabs/settings/`（プライバシー・ブロック・フェディバース・パスワード・mod の権限）、`components/publishing/`（公開環境と署名） |
| コントロールパネル（管理者）| `tabs/ControlPanelTab` | `components/admin/`（ユーザー・ロール・連合・お知らせ） |
| ワールドの中 | `pages/InstancePage` | `world/`（mod の読み込み・描画）。`worldApp/` は SNS 無しの world.html |

共通の部品は `components/ui/`（確認・トースト・絵文字の文字）と `components/emoji/`。

## lib

`components/<機能>/` と対になる `lib/<機能>/` に置く。API の呼び出し（`*Api.ts`。backend の API を呼ぶだけ）も同じ機能の中に置く。
直下は機能をまたぐ土台だけ（`api.ts`・`auth-client.ts`・`session.tsx`・`toast.ts`・`versionSkew.ts`）。

| lib | 中身（純粋な規則はテストあり） | 対になる components |
| --- | --- | --- |
| `social/` | `socialApi`・`inviteApi`・`fediverseApi`、`friendActions`（フレンド・フォロワーの操作）、`blocks`（購読）・`blocksState`（ストアの状態遷移）、`fediverse`（フォロワーの操作の反映） | `social/` |
| `profile/` | `profileApi`、`profileActions`（関係 → バナーの札と操作）、`bioLinks`・`bioCollapse`・`profileDraft`・`userPath` など | `profile/` |
| `messages/` | `messagesApi`、`messages`（届いたことの検知・未読・入力） | `messages/` |
| `notifications/` | `notificationsApi`、`notifications`（文面・タブ・期限）、`notificationActions`（種類 → カードの操作）、`notificationFeed`（一覧の合成） | `notifications/` |
| `home/` | `homeApi`・`homeStore`、`home`（ホームへの入り方） | `home/` |
| `worlds/` | `instancesApi`・`favoritesApi`・`instanceConnection`・`useRemoteVisit`、`joinVia`・`worldName`・`worldRef`・`worldProblems` | `worlds/` |
| `publishing/` | `externalWorksApi`・`cliAuthApi`、`publishingEnvironments`・`resign`・`keyFingerprint`（署名の部品は `signing/`） | `publishing/` |
| `admin/` | `adminApi`・`federationApi`、`roleForm`・`peerOrigin` | `admin/` |
| `account/` | 自分のアカウント（`me`・`useIsAdmin`・`adminStatus`・プライバシーの `favoritesVisibility`・`presenceVisibility`） | `hud/tabs/settings/`・`profile/` |
| `mods/`・`settings/`・`emoji/`・`signing/` | mod の取得元 `modCdn`・`serviceTokens`、端末の設定（`mediaOutputSetting` を含む）、絵文字、署名 | — |
