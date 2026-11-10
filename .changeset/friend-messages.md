---
"@ubichill/shared": minor
"@ubichill/db": minor
"@ubichill/backend": minor
---

フレンド同士のメッセージ（1 対 1）を足した（#198 の一部）。

- shared: `MESSAGE_LIMITS`・`messageRefusal`・`MessageContentSchema`・`SendMessageRequestSchema`・`DirectMessage`・`ConversationSummary`・`ConversationPage`・`mergeMessages` を足した。通知の種類に `Create`（object は `Note`）を足した（`AppNotification` の `object.type === 'Note'` は `Announce` だけではなくなった）。
- db: `direct_messages` を足し、通知の種類に `Create` を許した（0036）。
- backend: `/api/v1/messages`（会話の一覧・会話・送る・既読）。届いたら通知と SSE に載せる。古いメッセージは通知と同じ日数で消す。
