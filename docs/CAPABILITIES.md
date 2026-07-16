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

## capability 一覧

### safe（安全）

ワールド内で完結し外部副作用・情報流出が無い。**常に自動許可**され、ユーザーへの確認は出ない。

| capability | ラベル | 説明 | 許可されるコマンド |
| --- | --- | --- | --- |
| `scene:read` | シーンの読み取り | ワールド内のオブジェクト情報を読み取る | `SCENE_GET_ENTITY`<br>`SCENE_QUERY_ENTITIES` |
| `ui:toast` | 通知の表示 | 画面に一時的な通知（トースト）を表示する | `UI_SHOW_TOAST` |
| `ui:render` | UI の描画 | 自身の UI をワールド内に描画する | `UI_RENDER` |
| `event:emit` | ワールド内イベント送信 | 同じワールド内の他コンポーネントへイベントを送る | `EVENT_EMIT` |

### sensitive（要注意）

ワールド状態を書き換えるが外部へは出ない。**既定で許可**（ユーザー設定で「要承認」に変更可）。

| capability | ラベル | 説明 | 許可されるコマンド |
| --- | --- | --- | --- |
| `scene:update` | シーンの変更 | ワールド内のオブジェクトを作成・変更・削除する | `SCENE_CREATE_ENTITY`<br>`SCENE_UPDATE_ENTITY`<br>`SCENE_DESTROY_ENTITY`<br>`SCENE_SUBSCRIBE_ENTITY`<br>`SCENE_UNSUBSCRIBE_ENTITY` |
| `event:broadcast` | ブロードキャスト | ワールド内の全参加者へメッセージを一斉送信する | `NETWORK_BROADCAST` |
| `canvas:draw` | キャンバス描画 | 共有キャンバスに線・図形を描く | `CANVAS_FRAME`<br>`CANVAS_COMMIT_STROKE` |
| `media:control` | メディア再生の制御 | 動画・音声の読み込みと再生（再生/停止/シーク/音量）を操作する | `MEDIA_LOAD`<br>`MEDIA_PLAY`<br>`MEDIA_PAUSE`<br>`MEDIA_SEEK`<br>`MEDIA_SET_VOLUME`<br>`MEDIA_DESTROY`<br>`MEDIA_SET_VISIBLE`<br>`MEDIA_SET_DEVICE_CONTROL` |
| `avatar:set` | アバターの変更 | あなたのアバター表示を変更する | `AVATAR_SET` |
| `host:message` | ホストへの通知 | アプリ本体にプレイヤー状態（アバター等）の更新を依頼する | `NETWORK_SEND_TO_HOST` |

### dangerous（危険）

外部通信など情報流出/外部API操作のリスク。**既定で明示承認を要求**する。

| capability | ラベル | 説明 | 許可されるコマンド |
| --- | --- | --- | --- |
| `net:fetch` | 外部通信 (fetch) | 外部サーバーへ HTTP 通信する（許可したドメインのみ） | `NETWORK_FETCH` |

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
