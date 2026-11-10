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

- `*Api.ts`: backend の API を呼ぶだけ（`socialApi`・`notificationsApi`・`messagesApi`・`fediverseApi`・`adminApi` など）。
- 何を出すかの規則（純粋・テストあり）:
  - 通知: `notifications.ts`（文面・タブ・期限）、`notificationActions.ts`（種類 → カードの操作）
  - プロフィール: `profileActions.ts`（関係 → バナーの札と操作）、`friendActions.ts`（フレンド・フォロワーの操作）
  - メッセージ: `messages.ts`
  - ブロック: `blocksState.ts`（ストアの状態遷移）。購読は `blocks.ts`
- `account/`・`profile/`・`signing/`・`settings/`・`admin/`・`emoji/`・`mods/`: 機能ごとの規則と hook。
