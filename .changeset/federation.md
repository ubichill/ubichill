---
"@ubichill/shared": minor
"@ubichill/db": minor
"@ubichill/backend": minor
---

サーバー間の連合（federation v1）を足した。どの ubichill のサーバーの人とも、フレンドになり・招待し合い・相手のサーバーの部屋に入れる。

- 形は ActivityPub（AS2）。人から人への知らせ（フレンドの申請・承認・解除、招待、リクエストインバイト、プロフィールの更新）は相手の inbox へ、
  部屋の問い（入室・招待の権利・見えるか・フレンドの現在地）は部屋のサーバーへの RPC（`/federation/v1/...`）。
- 署名は RFC 9421（Ed25519・`sig1`）と RFC 9530 の Content-Digest。鍵は actor ごとに `FEDERATION_KEY_SEED` から導き、FEP-521a の Multikey で載せる。
  actor はオリジンで信頼する（FEP-fe34）。WebFinger・NodeInfo・`implements`（FEP-844e）で見つける。
- 来訪: 画面は自分のサーバーのまま、ホームが部屋のサーバーに入室を頼み、ブラウザの origin に結び付いた Go のチケットで部屋のサーバーにつなぐ。
  部屋の住所は `<部屋 ID>@<ドメイン>`（`/instance/:住所`）。
- 配送は DB の予定（`SKIP LOCKED`・同じ 2 人の間は順に・送り直し・サーキットブレーカー）。管理者はほかのサーバーを「新しいつながりを受けない」「連合しない」に絞れる。
- API: `/ap/*`・`/federation/v1/*`・NodeInfo、`/api/v1/federation`（状態・付き合い方・知っているサーバー）、`/api/v1/instances/:id/visit`。
  既存の API は、部屋の住所・actor の URL をそのまま受ける（`Instance.remote`・`UserSummary.domain`）。
- DB: 0030（`remote_actors`・`remote_servers`・`domain_policies`・`remote_friendships`・`federation_deliveries`・`federation_seen`・
  `remote_visits`・`federated_admissions`。招待とリクエストの相手の外部キーを外す）。
- 画面: ほかのサーバーの部屋には、部屋のサーバーでの ID（住所の `@` より前）で入る。
