<!-- このファイルは scripts/gen-capability-docs.mjs による自動生成物です。手で編集しないでください。 -->
<!-- 再生成: pnpm docs:capabilities -->

# mod 権限（capability）リファレンス

mod は必要な権限を `mod.json` の `capabilities` で宣言する（ビルド時に静的解析で自動補完もされる）。
宣言していない権限のコマンドは **default-deny** で拒否される。ここは唯一の定義元
[`packages/sandbox/src/host/capability.ts`](../packages/sandbox/src/host/capability.ts) から生成している。

- 定義済み capability: **11** 件（🟢 4 / 🟡 6 / 🔴 1）
- 未知の権限は安全側に倒して **dangerous** として扱われる（承認必須）。

## 危険度ティア

| ティア | 既定の挙動 |
| --- | --- |
| 🟢 safe | 自動許可（確認なし） |
| 🟡 sensitive | 既定で許可・設定で要承認に変更可 |
| 🔴 dangerous | 明示承認が必要 |

## 同意モデル

ゼロトラストで、信頼境界は Worker→Host の postMessage 一点。**mod 開発者は権限を宣言しない**
（使用 API からビルド時に自動生成される）。実際の許可はユーザーが与える。

- **mod 読み込み時に一括承認**: mod（Worker）が読み込まれた時点で、承認が要る capability を
  1 つのダイアログでまとめて許可/拒否する（実行時プロンプトではない）。途中で追加した mod も同様。
  **決定が済むまで Worker は実行しない**（コードのダウンロードのみ）ため「確認前に動く」ことがない。
  決定後は許可/拒否どちらでも Worker は動き、拒否された権限は実行時ゲートが個別に拒否する
  （mod 丸ごと停止にはしない）。実行時ゲートは**プロンプトを出さず即時に許可判定だけ**行う
  （高頻度 RPC がタイムアウトしない）。決定は localStorage に記憶。拒否診断は 3 秒レート制限。
- **fetch はドメイン単位で on-demand**（ドメインは読み込み時に不明なため）: `net:fetch` は
  ゲートを常に通し、実通信は**接続先ホスト名ごと**に「今回だけ / 次回以降も許可 / 拒否」の 3 択で承認。
  ポリシー: ① 自mod のアセット領域（modBase 配下）は承認不要 / ② 自mod の公開名前空間
  `/mods/<modId>/` も承認不要 / ③ 本体オリジンのそれ以外（コア `/api`・他mod領域）は**禁止** /
  ④ それ以外の外部ドメインはドメイン単位で承認。
- **シールドレベル**（設定画面）: なし / 確認（既定・危険のみ）/ 厳格な確認（注意も）/ 拒否。
- enforcement は単一ゲート。未承認コマンドは拒否（RPC は `CAPABILITY_DENIED`）。拒否は必ず
  console 診断＋トーストに出るため沈黙しない。

## capability 一覧

「発生元 API」= その API を mod が使うとビルド時にこの capability が自動付与される、の意。

### safe（安全）

ワールド内で完結し外部副作用・情報流出が無い。**常に自動許可**され、ユーザーへの確認は出ない。

| capability | ラベル | 発生元 API | 説明 | 許可されるコマンド |
| --- | --- | --- | --- | --- |
| `scene:read` | シーンの読み取り | `Ubi.entity.get / query, Ubi.state 読み取り` | ワールド内のオブジェクト情報を読み取る | `SCENE_GET_ENTITY`<br>`SCENE_QUERY_ENTITIES` |
| `ui:toast` | 通知の表示 | `Ubi.ui.showToast` | 画面に一時的な通知（トースト）を表示する | `UI_SHOW_TOAST` |
| `ui:render` | UI の描画 | `Ubi.ui.render` | 自身の UI をワールド内に描画する | `UI_RENDER` |
| `event:emit` | ワールド内イベント送信 | `Ubi.event.emit` | 同じワールド内の他コンポーネントへイベントを送る | `EVENT_EMIT` |

### sensitive（要注意）

ワールド状態を書き換えるが外部へは出ない。**既定で許可**（ユーザー設定で「要承認」に変更可）。

| capability | ラベル | 発生元 API | 説明 | 許可されるコマンド |
| --- | --- | --- | --- | --- |
| `scene:update` | シーンの変更 | `Ubi.entity().update/spawn/destroy, Ubi.state.sync 書き込み` | ワールド内のオブジェクトを作成・変更・削除する | `SCENE_CREATE_ENTITY`<br>`SCENE_UPDATE_ENTITY`<br>`SCENE_DESTROY_ENTITY`<br>`SCENE_SUBSCRIBE_ENTITY`<br>`SCENE_UNSUBSCRIBE_ENTITY` |
| `event:broadcast` | ブロードキャスト | `Ubi.event.broadcast` | ワールド内の全参加者へメッセージを一斉送信する | `NETWORK_BROADCAST` |
| `canvas:draw` | キャンバス描画 | `Ubi.canvas.*` | 共有キャンバスに線・図形を描く | `CANVAS_FRAME`<br>`CANVAS_COMMIT_STROKE` |
| `media:control` | メディア再生の制御 | `Ubi.media.*` | 動画・音声の読み込みと再生（再生/停止/シーク/音量）を操作する | `MEDIA_LOAD`<br>`MEDIA_PLAY`<br>`MEDIA_PAUSE`<br>`MEDIA_SEEK`<br>`MEDIA_SET_VOLUME`<br>`MEDIA_DESTROY`<br>`MEDIA_SET_VISIBLE`<br>`MEDIA_SET_DEVICE_CONTROL` |
| `avatar:set` | アバターの変更 | （自動検出対象外） | あなたのアバター表示を変更する | `AVATAR_SET` |
| `host:message` | ホストへの通知 | `Ubi.event.sendToHost` | アプリ本体にプレイヤー状態（アバター等）の更新を依頼する | `NETWORK_SEND_TO_HOST` |

### dangerous（危険）

外部通信など情報流出/外部API操作のリスク。**既定で明示承認を要求**する。

| capability | ラベル | 発生元 API | 説明 | 許可されるコマンド |
| --- | --- | --- | --- | --- |
| `net:fetch` | 外部通信 (fetch) | `Ubi.fetch` | 外部サーバーへ HTTP 通信する（許可したドメインのみ） | `NETWORK_FETCH` |

## プロトコルバージョン

SDK（mod）と Host（本体）は独立して更新されるため、初期化時に互いのプロトコルバージョンを
名乗り合い、非互換を検出して警告する（詳細は
[`packages/shared/src/mod/protocol.ts`](../packages/shared/src/mod/protocol.ts)）。

- 現在の `PROTOCOL_VERSION`: **1**
- 互換可能な最小バージョン `MIN_COMPATIBLE_PROTOCOL_VERSION`: **0**

進化ルール（後方互換の生命線）:

- コマンド名・イベント名の値は **削除・改名しない**（追加のみ）。ペイロードのフィールドは optional でのみ追加する。
- 加算的変更のたびに `PROTOCOL_VERSION` を +1 する。
- やむなく互換を壊す変更のときだけ `MIN_COMPATIBLE_PROTOCOL_VERSION` を引き上げる。

加算的進化である限り「古い mod × 新しい Host」は常に動作する。危険なのは「mod が Host より新しい」場合のみで、
このとき Host は未対応コマンドを持たない恐れがあるため `degraded` として開発者に警告する。
