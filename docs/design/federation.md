# サーバー間の連合（federation v1）

どの ubichill のサーバーの人とも、フレンドになり・招待し合い・相手のサーバーの部屋に入れるようにする。
中央のサーバーは置かない。部屋のことは部屋のサーバー、人のことはその人のホームのサーバーが決める（権威の分散）。

- 約束ごとの種類は [PROTOCOLS.md](../PROTOCOLS.md) の C（版の違うほかのサーバーが相手。**足すだけ**）。
- 形は ActivityPub（AS2）に合わせるが、相手は ubichill のサーバーだけ（Mastodon などとフレンドにはならない）。
- 規則のコードは `shared/src/federation/`（署名・actor・activity・部屋 RPC・配送・URL の確かめ）、
  実体は `backend/src/services/federation/`、口は `backend/src/routes/federation/`。

## 2 つの面

| 面 | 何を | どう | 例 |
|---|---|---|---|
| AP 面 | 人から人への知らせ | 相手の inbox へ AS2 の activity を送る（非同期・送り直す） | フレンドの申請・承認・解除、招待、リクエストインバイト、プロフィールの更新 |
| 部屋 RPC 面 | 部屋のサーバーへの問い | `/federation/v1/...` へ署名付きの POST（同期） | 入室、招待の権利、見えるか、フレンドの現在地 |

知らせは配送の予定（DB）に積んで送り直す。部屋の問いは、その場で部屋のサーバーが答える（部屋の在室・公開範囲は部屋のサーバーしか知らない）。

## ID と鍵

| もの | 形 |
|---|---|
| 人の actor | `https://<domain>/ap/users/<ユーザー ID>`（handle を入れない。改名しても変わらない） |
| サーバーの actor（Application） | `https://<domain>/ap/actor`（アカウントはホスト名） |
| 部屋 | `https://<domain>/ap/instances/<部屋 ID>`。画面の住所は `<部屋 ID>@<domain>`（`/instance/:住所` でどのサーバーの部屋にも入る） |
| 鍵 | Ed25519。actor ごとに `FEDERATION_KEY_SEED` から HKDF で導く（秘密鍵は保存しない）。文書には FEP-521a の Multikey（`assertionMethod`）で載せ、keyid は `<actor>#ed25519-<世代>`（既定 1）。ほかの実装向けの RSA の鍵は別（下の「ほかの実装との署名」） |

鍵の種を差し替えると全員の鍵が変わるだけで、ほかのサーバーは文書を取り直して追従する（鍵を固定しない）。

鍵の移行（種の差し替え）の手順:
1. `FEDERATION_KEY_SEED_PREVIOUS` に今の種、`FEDERATION_KEY_SEED` に新しい種を置き、`FEDERATION_KEY_GENERATION` を 1 上げる。keyid が変わるので、受け手は知らない keyid として 30 秒あけてすぐ文書を取り直す（同じ keyid のまま署名が通らないときの取り直しは 5 分ごと）。
2. 移行の間は前の世代の鍵も文書に載せる（前の鍵で署名して送った分も通る）。相手の 401 は送り直す（古い鍵を覚えているだけのことがあるため）。
3. 送り直しの期限（48 時間）と相手のキャッシュ（24 時間）が過ぎたら `FEDERATION_KEY_SEED_PREVIOUS` を外す。
サービストークンの鍵（`SERVICE_TOKEN`）とは別の鍵（用途ごとに分け、片方の漏えいがもう片方に広がらない）。

## 署名（RFC 9421 の ubichill プロファイル）

- Ed25519 だけ（`alg="ed25519"`）。ラベルは `sig1`。本文の要約は RFC 9530 の `Content-Digest`（sha-256）。
- 必ず含める項目: POST は `@method` `@target-uri` `content-type` `content-digest`、GET は `@method` `@target-uri`。
- 時刻: `created` は受け手の時刻の −300 秒〜+60 秒。`expires` は 30 秒の猶予、`created` から最長 300 秒。
- 入室と招待の権利（権利を返す RPC）は `nonce` 必須。受け手は `(keyid, nonce)` を 6 分覚えて 2 度目を断る。
- 受け手は `@target-uri` を**自分の正規のオリジン**と受けたパスから組み立てる（Host ヘッダーを信じない）。署名は宛先に縛られ、別のサーバーへ転用できない。
- 照合は shared の `verifySignature` の 1 か所（PROTOCOLS.md の「署名の照合は shared の 1 か所」）。通らなければ、文書が 5 分より古いときだけ 1 度取り直す。
- 送るときは毎回署名し直し、リダイレクトに従わない（署名を別の相手へ持ち出させない）。RFC 9421 の付録 B.2.6 と RFC 9530 の値でテストしている。

## actor の確かめ（オリジンによる信頼、FEP-fe34）

- 取りに行った URL と文書の `id` が同じ（ほかのオリジンの文書で乗っ取らせない）。
- `inbox`・`sharedInbox` は actor と同じオリジン（このサーバーを使って第三者へ送らせない）。
- 鍵の `controller` は actor、鍵の `id` は `<actor>#…`。
- 人の actor は WebFinger を往復して、`acct:<preferredUsername>@<ホスト>` の `self` が actor の `id` と同じときだけ受ける。
- 受けた activity の `id` と `actor` は同じオリジン。`actor` は署名した actor と同じ（ほかの人を名乗らせない）。
- 文書は 1 時間そのまま使い、24 時間までは使いながら裏で取り直す。410 は消えた印。初めての取得はドメインごとに 30 回/分まで。

## 見つける

- `/.well-known/webfinger`: 人の `self`（`application/activity+json`）とプロフィールの画面。
- `/.well-known/nodeinfo` → `/nodeinfo/2.1`: ubichill のサーバーか（`metadata.ubichill.federation.version`）。
- 機能は Application actor の `implements`（FEP-844e）で告知する。使う前に相手が告知しているかを見る（NodeInfo の列挙は機能の判定に使わない）。
  - 告知を読めたうえで載っていない機能は、送る・移動する前に断る（フレンドの申請・招待・リクエストインバイト・部屋の作りの取得と入室）。招待の候補の一覧にも「対応していません」と出す。現在地は答えないサーバーに尋ねない。
  - 告知を読めなかった（Application actor を取れない）ときは「持たない」と記録しない。一時的な失敗で送るのをやめないため。
- 部屋の作り（RoomCard）は部屋（Go）の通信の版 `protocolVersion` を載せる（無ければ 1）。来訪者のホームは、画面が話せない版の部屋を「入れない」として見せ、入室も断る（移動してから断られないように）。
- 知っているサーバーは、連絡がつくたびに自動で記録する（`remote_servers`）。管理者が手で登録する必要はない。

## AP 面の activity

| 出来事 | activity | 宛先 |
|---|---|---|
| フレンドの申請 | `Offer{Relationship friendOf}`（AS2 の例 147） | 相手の inbox |
| 承認・断る | `Accept{Offer}`・`Reject{Offer}` | 申請した人 |
| 取り消し・解除 | 申請した側は `Undo{Offer}`、承認した側は `Undo{Accept}` | 相手 |
| 招待 | `Invite{object: Instance, target: 相手}`（`endTime` は期限、`content` は一言） | 招待された人 |
| リクエストインバイト | 拡張の `RequestInvite{object: 頼む相手}` | 頼む相手 |
| プロフィールの更新 | `Update{Person}`（受けたら文書を取り直す） | フレンドのサーバーの共有の inbox に 1 通 |
| 退会 | `Delete{actor}` | — |

- 届かなかった承認・解除・取り消しは、相手のホームに `friendships/check` で関係を確かめて埋め合わせる（10 分ごとの掃除で 20 件ずつ。確かめていないもの・1 日たったものから。届けられずに諦めた相手は早める）。
  - こちらはフレンド・相手は関係なし → 消す。こちらはフレンド・相手は申請中 → 承認を同じ id で送り直す。
  - こちらは申請中・相手はフレンド → フレンドにする。申請中・相手は関係なし（送り直しの期限 48 時間の後）→ 消す。
  - 相手から申請が来ている・相手は関係なし → 消す。古いサーバー（`state` を答えない）には承認の送り直しだけ。
- お互いに申請したらフレンド（今のフレンドと同じ）。すれ違ったときは相手の Offer の id も持ち、どちらが自分の Offer の Undo で解除しても両側で消える。承認・断るは「自分が出した Offer を、その相手から」だけ受ける。
- 断ったら 7 日は同じ相手からの申請を受けない。受けた申請は 1 人 100 件まで（30 日で失効）。取り消した Offer の id は 14 日覚え、遅れて届いた申請を無視する。
- 招待・リクエストは**フレンドからだけ**受ける（知らない人のものは捨てる）。招待で入る権利は部屋のサーバーが持つので、受けた側は通知にするだけ。
- 同じ activity の 2 度目は何もしない（処理し終えたら 7 日覚える）。処理に失敗したら、相手の送り直しを受ける。処理中に同じ activity が届いたら 503（`Retry-After`）で送り直してもらう。
- フレンドの関係は、同じ 2 人の処理を順番にする（2 人の組ごとの advisory lock。関係の書き込みと送る予定を 1 つのトランザクションに入れ、通知は確定後）。
- 知らない型・知らない項目は受けて捨てる（202。`.strict()` にしない。相手の版が新しくても壊れない）。

## 部屋 RPC 面

| パス | 署名する actor | 何を |
|---|---|---|
| `GET /ap/instances/:id` | 見る人 | 部屋の作り（`RoomCard`）と入れるか。見えなければ無い部屋と同じ 404 |
| `POST /federation/v1/rooms/join` | 来訪者（nonce 必須） | 入室。来訪者のブラウザの origin に結び付けた Go のチケットを返す |
| `POST /federation/v1/rooms/grants` | 招く人（nonce 必須） | 部屋にいるほかのサーバーの人が、フレンドを招待する権利を作ってもらう |
| `POST /federation/v1/rooms/visibility` | 中にいる人のホーム（Application） | その人のフレンドに部屋が見えるか・入れるか |
| `POST /federation/v1/presence` | 見る人 | フレンドの現在地（見る人とフレンドの人についてだけ答える） |
| `POST /federation/v1/friendships/check` | Application | 2 人がフレンドか。尋ねられるのは、相手（other）のホームと、本人（user）が来訪中の部屋のサーバーだけ |

エラーは problem+json（RFC 9457）。`code` は `invite-required`・`full`・`domain-limited`・`rate-limited`・`not-inside` など（`shared/federation/rpc.ts`）。
部屋の作りは人の一覧を出さず人数だけ。ワールドの名前・画像は表示のヒントで、作者の確認は見る人のサーバーがワールドの URL から行う。

## 来訪（ほかのサーバーの部屋に入る）

画面（SPA）は自分のホームのまま。トークンを URL に載せない・リダイレクトしない。

```
ブラウザ ──POST /api/v1/instances/<id>@<B>/join──▶ ホーム A
ホーム A ──POST /federation/v1/rooms/join（本人の鍵・nonce・clientOrigin）──▶ 部屋のサーバー B
B: 見える・入れる・満員でない・A からの来訪者が 20 人未満 → Go のチケット（origin = A の画面）
ホーム A ──{ token, url: wss://B/... }──▶ ブラウザ ──WebSocket（Origin: A の画面）──▶ B の Go
```

- B の Go（`--federated-visits`）は、自分の画面でない origin からの接続を、その origin に結び付いたチケットでだけ入れる。
  自分の画面の origin の接続には origin の無いチケットを求める（チケットを別の画面で使わせない）。
- WebSocket は部屋のサーバーと同じホスト名に限る（ほかの相手へつながせない）。`clientOrigin` は来訪者のホームと同じホスト名に限る。
- 入室は部屋のサーバーでの ID で行う（住所の `@` より前）。来訪者の Go の参加者 ID は actor の URL。
- 一度入れた来訪者は、部屋が続く間は入り直しに招待を求めない（`federated_admissions`）。
- 来訪中は画面が 30 秒ごとにホームへ知らせ（`POST /api/v1/instances/:id/visit`）、90 秒途切れたら来訪をやめたとみなす（`remote_visits`）。
- ワールドの中身・mod の lock は部屋のサーバーの Go が配る。mod は lock の置き場所か自分のサーバーから読み、いつもどおり作者の署名を確かめる。

## フレンドの現在地

現在地は配らず、見る人のホームが尋ねる（pull。15 秒使い回す）。相手のサーバーにつながらない（通信の失敗・5xx・429）ときは「確認できない」として、最後に確かめた場所と時刻（1 時間以内）を添える。いない（offline）とは言わない。答える側では、来訪先の部屋のサーバーにつながらなければ private と答える（約束の状態に unreachable は足さない。古いサーバーが読めなくなるため）。来訪の記録が途切れた後に続けている知らせが来たら、ホームは部屋のサーバーに部屋を尋ね直して記録し直す。

- ほかのサーバーのフレンド: そのホームに、ホームごとにまとめて尋ねる。ホームは、見る人とフレンドの人についてだけ答える（ほかの人はいるかどうかも伏せる）。
- このサーバーのフレンドで、ほかのサーバーの部屋に来訪中の人: 部屋のサーバーに `visibility` で尋ねる。
- 部屋の公開範囲の判定は部屋のサーバーが行う。招待のみの部屋は、中にいる人のフレンドには見えるが入るには招待が要る（`canJoin: false`。画面は「リクエスト」）。
- 来訪者の部屋の見え方を尋ねるのは、その来訪者のホームだけ（`member` のホストと署名したサーバーが同じ）。
- 部屋の作り（`GET /ap/instances/:id`）と入室でも、表示と同じ関係を使う。フレンド+・招待のみの部屋で、見る人と中にいるほかのサーバーの人の関係を部屋のサーバーが知らなければ、その人のホームに `friendships/check` で尋ねる（1 回に 10 人まで・30 秒使い回す）。見る人のホームは「会いに行くフレンド」（画面が現在地で見た、その部屋にいるフレンド）を `via` で渡し（部屋の作りは問い合わせ、入室は本文）、部屋のサーバーはその人から先に尋ねる。上限があっても、参加の順や部屋の人数で入れたり入れなかったりしないため。`via` は尋ねる順を変えるだけで、関係はホームに確かめる。
  ホームが答えるのは、本人が今その部屋のサーバーに来訪しているときだけ（visibility で伝えている範囲と同じ。ほかの付き合いは探らせない）。

## 招待とリクエスト

- このサーバーの部屋から、ほかのサーバーのフレンドへ: 権利はこのサーバーの `instance_invites`（相手は actor の URL）、`Invite` を相手へ届ける。
- 来訪中のほかのサーバーの部屋から: 部屋のサーバーに `grants` で権利を作ってもらい、このサーバーの人には通知、ほかのサーバーの人には `Invite`。
  部屋の規則（作成者のフレンドか・もう中にいるか）は部屋のサーバーが確かめ、相手が招く人のフレンドかは招く人のホームが保証する。
- ほかのサーバーのフレンドへのリクエストは `RequestInvite`（同じ相手へは期限内に 1 度）。ほかのサーバーの部屋にいるフレンドにも頼める。
- 期限は招待が最長 24 時間、リクエストが 1 時間（受けた側も縮める）。

## 配送

- 予定は `federation_deliveries`（backend が落ちても失われない）。何台で動かしても `FOR UPDATE SKIP LOCKED` で同じ予定を 2 度送らない。
- 同じ 2 人の間は出した順に届ける（申請 → 取り消しが逆に届かない）。1 つのホストへは同時に 4 つまで。
- 送り直し: 30 秒から 24 時間まで間隔を延ばす（±20% のゆらぎ）。48 時間か activity の期限を過ぎたら諦める。
- 続けて失敗するホストは止め（サーキットブレーカー）、3 日届かなければ到達できないとして 6 時間ごとにだけ試す。
- 400・403・404・413・422 は送り直さない（相手が受けないと決めた）。401 は送り直す（鍵を差し替えた直後に、相手が古い鍵を覚えているだけのことがある）。410 は相手が消えたとして諦める。429 は `Retry-After`（最長 1 時間）に従う。

## フェディバース（Mastodon・Misskey など）からのフォロー

ubichill のユーザーは、Mastodon・Misskey などから `@<handle>@<domain>` で検索してフォローできる。フレンドとは別の片方向の関係で、
フォロワーに見えるのはプロフィール（とこれから公開するノート）だけ。現在地・来訪・招待はフレンドだけ。

| 出来事 | activity |
|---|---|
| フォローされた | `Follow{Person}` を受ける |
| 承認・断る・フォロワーから外す | `Accept{Follow}`・`Reject{Follow}`（受けた Follow をそのまま埋め込む。外すときも Reject。Mastodon と同じ） |
| フォローをやめた | `Undo{Follow}` を受ける（Follow の id で引く。id が合わなければ埋め込まれた Follow の相手と宛先で引く） |
| 承認制・検索の可否を変えた | `Update{Person}` をフレンドとフォロワーへ |

- 承認制（`manuallyApprovesFollowers`）は初期値オフ（Misskey・Mastodon と同じ）。オンなら承認待ちにして通知し、本人が承認・拒否する。
  オフに戻したら承認待ちはまとめて承認する。承認待ちは 1 人 500 件まで（超えた分は断る）。
- `limit` のサーバーからのフォローは断る。同じ人から Follow が来直したら（相手の記録が外れた）、今の状態で答え直す。
- 取り下げた Follow の id は 14 日覚える（Undo が先に処理されても、遅れて届いた Follow でフォローに戻さない）。
- 読んでから書くまでは 2 人ごとに advisory lock を取り、答え（Accept・Reject）は書き込みと同じトランザクションで送る予定に入れる。
- フォロワー・フォローのコレクションは件数だけ公開する（誰がフォローしているかは出さない）。actor の文書には
  `followers`・`following`・`manuallyApprovesFollowers`・`discoverable`／`indexable`（Mastodon）を載せ、自己紹介は段落と改行だけの HTML にする。
- 設定とフォロワーの管理は `GET /api/v1/fediverse`・`PUT /api/v1/fediverse/settings`・`POST /api/v1/fediverse/followers/{approve,reject}`。

### プロフィール

ubichill のプロフィールに出しているものは、すべて actor の文書に載せる（ほかの実装で同じに見えるように）。

| ubichill | actor の文書 | ほかの実装での見え方 |
|---|---|---|
| 表示名・アイコン・自己紹介 | `name`・`icon`・`summary`（段落と改行だけの HTML） | そのまま |
| バナー | `image` | ヘッダー画像 |
| 作った日 | `published` | 登録日 |
| リンク | `attachment` の `PropertyValue`（値は `rel="me"` のリンク。名前はサービス名、Web サイトはホスト名） | 補足情報の表 |
| 話せる言語・ひとこと | `attachment` の `PropertyValue`（「話せる言語」「ひとこと」）と、拡張の語 `statusMessage`・`spokenLanguages` | 補足情報の表 |

- ubichill どうしは拡張の語でひとことと言語を元の形に戻し、同じ名前の `PropertyValue` は表に重ねて出さない。
  拡張の語の無い相手（Misskey など）が「ひとこと」という名前の項目を書いていれば、表に残す。
- ほかのサーバーの人を読むときは、`image` をバナーに、`attachment` の `PropertyValue` を 16 件まで読む。https のリンクを持つ項目は
  プロフィールのリンク（5 件まで。同じリンクは 1 つ）にし、ほかの項目とあふれたリンクは補足情報の表に出す。自己紹介は改行を残して 1500 文字まで読む。
- 読んだ形は `remote_actors.banner`・`remote_actors.profile` に置き、出す前に shared の `remoteProfileView` で確かめ直す。
  変わったことは相手からの `Update{Person}`、または actor を取り直したときに分かる。

### 固定ノート（`featured`）

プロフィールに載っている公開の情報から、固定ノートを作る（本人が書いたノートではない）。ほかの実装は 5 件まで読むので、
作ったワールド 2・公開している mod 2・お気に入り 1（それぞれ新しい順）にする。

- 作ったワールド: ユーザーページと同じ条件（署名して公開したもの・本人の署名で配られていると確かめた外部のもの）。リンクは共有ページ。
- 公開している mod: 本人の署名付きで配られていると確かめたもの。mod のページは無いので、リンクはユーザーページ。
- お気に入り: **公開範囲がパブリックのときだけ**（フレンドだけ・本人だけなら材料も読まない）。自分で作ったワールドは重ねて出さない。
- ノートは `GET /ap/users/:id/collections/featured`（埋め込み）と `GET /ap/users/:id/featured/:key`（Mastodon は id を取り直して確かめる）。
  id は種類と項目の id の要約で、並びが変わっても変えない。宛先は公開とフォロワー。画像は拡張子で種類が分かるときだけ添付する。
- 中身が変わったら（ワールドの保存・削除、外部の作品の登録・削除、お気に入り、その公開範囲）、1 分覚えた分を捨て、30 秒まとめてから
  `Update{Person}` をフレンドとフォロワーへ送る（相手は actor を取り直すときに featured も取り直す）。

### ほかの実装との署名（draft-cavage・RSA）

Mastodon・Misskey は RFC 9421 の Ed25519 を確かめないので、ほかの実装とは draft-cavage-http-signatures-12 の `rsa-sha256` で話す。

- RSA の鍵（2048 ビット）は actor ごとに初めて要るときに作り、`federation_actor_keys` に置く（種から導けないため）。秘密鍵は種から
  HKDF で導いた鍵で AES-256-GCM に包む（actor の id を AAD に入れる）。文書には `publicKey`（keyId `<actor>#main-key`）で載せる。
  種を差し替えたら前の種で開けて包み直す。どちらでも開けなければ作り直す（相手は署名が通らなければ文書を取り直す）。
- 送る: 相手のサーバーが Application actor で `rfc9421Ed25519` を告知していれば RFC 9421、していなければ（知らないサーバーも）draft-cavage。
  署名する項目は POST が `(request-target) host date digest content-type`、GET が `(request-target) host date accept`。
  入室など nonce の要る RPC は必ず RFC 9421。
- 受ける: `Signature-Input` があれば RFC 9421。無ければ draft-cavage を受けるのは **inbox だけ**（部屋 RPC・部屋の作りは RFC 9421 だけ）。
  `(request-target)`・`host`・`date`（POST は `digest` も）が署名されていなければ断る。`host` と `(request-target)` は自分の正規の
  ドメインと受けたパスから組み立てる。`Date` は受け手の時刻の 1 時間前〜5 分後まで（相手の送り直しの列の遅れを見込む。2 度目は activity の id で弾く）。
  RSA は 2048 ビット未満を受けない。照合は shared の `verifyCavageSignature` の 1 か所。

## 付き合い方（管理者）

どの ubichill のサーバーとも連合するのが既定。問題のあるサーバーだけを絞る（設定 → 連合 → ほかのサーバー）。

| 方針 | 意味 |
|---|---|
| 連合する | 既定 |
| 新しいつながりを受けない（limit） | 新しい申請・招待・リクエスト・来訪を受けない。今あるフレンドはそのまま |
| 連合しない（block） | 送受信・取得をすべてやめ（WebFinger も送らない）、そのサーバーの人とのフレンドとフォローも切る（10 分ごとの掃除でも消し直す） |

サブドメイン・ポート違いにも効く（`spam.example` を block すれば `a.spam.example` も）。受けた要求は署名したサーバーごとに回数を絞る（IP ごとの全体の上限からは外す）。

## 動かす

| 環境変数 | 意味 |
|---|---|
| `FEDERATION_KEY_SEED` | 鍵の種（32 バイト以上の base64 か 16 進）。本番は必須（無ければ連合しない）。開発では `BETTER_AUTH_SECRET` から導く |
| `FEDERATION_KEY_GENERATION` | 鍵の世代（既定 1）。種を差し替えるときに 1 上げる |
| `FEDERATION_KEY_SEED_PREVIOUS` | 鍵の移行の間だけ、前の世代の種（世代が 2 以上のときだけ置ける） |
| `FEDERATION_ENABLED=false` | 連合を止める |
| `FEDERATION_ALLOW_HTTP=true` | 開発で http の相手を受ける（本番では効かない）。手元で 2 台を試すときは `WORLDS_FETCH_ALLOW_PRIVATE=true` も |
| `INSTANCE_FEDERATED_VISITS`（Go） | ほかのサーバーの画面からの接続を受ける（既定 true） |

- Ingress は `/ap`・`/federation`・`/.well-known/nodeinfo`・`/nodeinfo` を backend へ送る（`/.well-known/webfinger` と同じ）。
- 画面とバックエンドは同じホスト名で配る（来訪のチケットを画面の origin に結び付けるため）。
- 手元で 2 台を試す: A を 3100/3101/3102、B を 3200/3201/3202 で動かし、`@<ID>@localhost:3201` で探す。

## 決めていないこと・この先

- 退会（`Delete{actor}` を送る）は、退会の流れができたら足す。受ける側は対応している。
- ワールドの中身は部屋のサーバーの Go が配るので、来訪者のサーバーが確かめたワールドと同じ中身かまでは保証しない（mod は作者の署名で確かめる）。
- サーバーの版が違うと、Go の通信の版（`protocolVersion`）が合わない部屋には入れない（画面は「非対応の通信バージョン」を出す）。
- 公開の部屋の一覧（ほかのサーバーのパブリックの部屋を探す）は、ワールドの連合のピアの上に足す。
- フェディバース: ノートを書く（公開範囲を選んで `Create{Note}` をフォロワーへ。今いる部屋の共有も）、ほかの実装の人をフォローして読む、は順に足す。keyId が actor の下にない実装（GoToSocial の
  `/main-key` など）の署名はまだ受けない。
