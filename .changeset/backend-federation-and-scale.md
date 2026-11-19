---
"@ubichill/backend": patch
"@ubichill/db": patch
"@ubichill/shared": patch
---

連合の受信を堅牢にする（Signature ヘッダーの ReDoS・署名を確かめる前の actor の取得の制限・落ちたサーバーによる確かめ直しの詰まり・Undo と Accept の id）。登録の 3 つの口に回数の制限を付ける。`user_friends.friend_id`・`sessions.user_id`・`accounts.user_id` に索引を足し（migration 0037）、フレンドの分類の O(n²)・在席の全件読み・ワールド一覧の全件解決を直し、ワールドの数の上限を並列でも守る。
