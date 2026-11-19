# フェディバースログインと認証設定

Mastodon・Misskey のアカウントで Ubichill に登録・ログインできるようにする。SSO での新規登録にはメールもパスワードも要らない。招待から来た人は、所属サーバーで認証し、Ubichill の ID と表示名を決めれば元のワールドや部屋に戻れる。

Ubichill のユーザー ID が、引き続きワールド、作者鍵、プロフィール、フォローの持ち主を表す。外部アカウントはログイン手段として紐づける。連合で使う actor やフォローの規則は [連合の設計](federation.md) を参照。

## 段階

| 段階 | 内容 | 設定の置き場所 |
| --- | --- | --- |
| A（このブランチ） | SSO の登録・ログイン・連携・解除、メールなしユーザー、管理者はメール必須 | 環境変数 |
| B | コントロールパネルの「認証」（ログイン方法・新規登録・メール確認の方針を画面から変える） | Postgres |
| C | メール送信の差し替え（SMTP）と Bot 保護（まず Turnstile） | Postgres |

A だけで招待からの登録は通る。B・C はログインを止める障害の原因を増やすので、A を本番で使ってから必要な分だけ足す。

## 登録・ログイン・連携（A）

1. ログイン画面に「フェディバースで続ける」を 1 つだけ出す。入力はサーバーのドメインかハンドル（`misskey.io`・`@you@mastodon.social`）。Mastodon か Misskey かは選ばせず、サーバーから判定する（下の「対応するサーバー」）。
2. 連携済みならそのユーザーでログインする。初回は外部のユーザー名と表示名から候補を出し、ID と表示名を確定してもらう（既存の一意の規則のまま。重複はその場で直せる）。カスタム絵文字の `:name:` は候補から外す。
3. 完了後は元の招待やワールドに戻る。入室できるかは従来の入室判定で確かめる。戻り先は Ubichill 内の相対 URL に限る（`//`・`/\`・制御文字・外部 URL は `/`）。中断・期限切れ・拒否は理由をログイン画面に出す。

既存ユーザーは「設定 → アカウント → ログイン方法」から外部アカウントを追加する。開始したセッションと同じセッションで戻ってきたときだけ追加する（途中でログインし直したら追加しない）。別のユーザーに紐づいた外部アカウントの移し替えや、メール・名前の一致による自動連携は行わない。外部で改名してもログインでき、表示用の名前はログインのたびに更新する。サーバー移転時は、ログインできるうちに移転先のアカウントを追加する。

解除では、ユーザーの行を `FOR UPDATE` で押さえてからログイン手段を数え、最後の 1 つは外さない。同時に複数外しても 1 つ残る。パスワードの行はこの操作では外せない。

### メールなしユーザー

Better Auth 1.7 は `email` を一意の文字列として扱い、`users.email` も `NOT NULL UNIQUE`。SSO で登録したユーザーの `users.email` には、乱数と予約ドメインの内部値（`<乱数>@sso.invalid`）を入れ、`emailVerified` は `false` にする。 [予約ドメインの規定](https://www.rfc-editor.org/rfc/rfc2606.html#section-2)

- 連絡先として使ってよいかは shared の `contactEmailOf` だけで判定する（確認済みで、予約ドメインでないもの）。`sendAccountNotice` はユーザーを受け取り、連絡先が無ければ送らない。`user.email` を直接宛先にしない。
- メール登録では `.invalid` のアドレスを受け付けない。内部値にはパスワードの行が無いので、メールでのログインにも使えない。
- Better Auth の `/get-session` は本人にだけ内部値を返す。画面はメールアドレスを表示していないので、加工はしない。表示するときは `contactEmailOf` を通す。
- 連絡先メールの追加（確認コードで確かめてから内部値を置き換える）は A に含めない。それまでに管理者になりたい人や、復旧の手段がほしい人は、メールで登録してから SSO を追加する。

### 管理者はメール必須

管理者は、確認済みのメールアドレスを持つユーザーだけにする。外部サーバーが乗っ取られたり、ドメインを取り直されたりしても、管理者の権限は渡さない。また、復旧の連絡先を必ず持たせる。

- 管理者のロールの付与は、相手に確認済みのメールが無ければ断る。
- 管理者の判定（`isAdmin`・コントロールパネルの一覧）でも同じ条件を見る。後からロールを管理者にした場合や、DB に直接入った場合でも、メールの無い人は管理者にならない。
- 公式アカウント（`@ubichill`）は従来どおり常に管理者（起動時に確認済みのメールで作る）。

## 対応するサーバー

公開メタデータ（RFC 8414 `/.well-known/oauth-authorization-server`）を取得し、実際に備えるもので判定する。バージョン文字列は見ない。 [Misskey の OAuth](https://misskey-hub.net/ja/docs/for-developers/api/token/oauth/) · [Mastodon の OAuth と権限](https://docs.joinmastodon.org/api/oauth-scopes/)

| | Mastodon（4.3 以降） | Misskey 系（2023.9.0 以降） |
| --- | --- | --- |
| 判定 | `app_registration_endpoint` と `profile` の権限がある | `read:account` の権限と `authorization_response_iss_parameter_supported: true` |
| クライアント | `POST /api/v1/apps` で認証サーバーと戻り先 URL ごとに 1 回登録し、使い回す | `client_id` は Ubichill の URL（`/api/auth/fediverse/client/<host>`）。返す HTML の `<link rel="redirect_uri">` に戻り先を載せる |
| 本人の取得 | `GET /api/v1/accounts/verify_credentials` | `POST /api/i`（`host` が入っていたら他サーバーの人なので断る） |
| 応答の照合 | サーバーごとに違う戻り先 URL と、開始時の state | 戻り先 URL と state に加え、`iss` を開始時の issuer と完全一致で照合 |
| トークン | 本人を確認したら `revocation_endpoint` で失効させる | 失効の口が無いので保存せずに捨てる（Misskey の「連携アプリ」に残る） |

共通の条件は次のとおり。

- 認可・トークンのエンドポイントは、認証サーバーと同じ origin の https に限る。失効・登録の口が別の origin を指すなら、その口は使わない。
- 認可コードと PKCE（S256）を使う。

Sharkey など Misskey の派生も、上の条件を満たせば同じ扱いになる。

## 仕組み（A）

### 外部アカウントのキー

`accounts.providerId = fediverse:<認証サーバーの origin>`、`accounts.accountId = サーバー内のユーザー ID`。ソフトウェアの種類はキーに含めない。判定が揺れたり、サーバーがソフトウェアを乗り換えたりしても、別人にしないためである。`(providerId, accountId)` に一意制約を置く（既存の行は `credential` と user id の組なので重複しない）。

表示用の情報（種類・ユーザー名）は `external_account_profiles`（accounts と 1 対 1）に置き、識別には使わない。Better Auth の表は広げない。

### 認証の途中の状態

短命な値は Postgres の `verifications`（Better Auth の表。Ubichill は Better Auth のメール確認を使っていないので、ほかに書く人はいない）に、種類の前置きと SHA-256 のハッシュを identifier にして置く。Redis は使わない（無い構成でも動かすため）。

| 値 | 期限 | 中身 | 使い方 |
| --- | --- | --- | --- |
| state | 10 分 | サーバーのメタデータ、client_id、戻り先 URL、PKCE verifier、ブラウザーの印のハッシュ、操作（sign-in / link）、戻り先、画面の origin、link なら開始時のユーザーとセッション | 応答で `DELETE … RETURNING` により一度だけ取り出す |
| 登録の途中 | 30 分 | 外部アカウントのキー、ユーザー名、表示名、戻り先 | ID と表示名の確定で使い、ユーザーを作ったら消す。ID が重複したら残して直させる |

ブラウザーには、署名付き・httpOnly・`SameSite=Lax`・`Path=/api/auth/fediverse` のクッキーを 2 つ渡す。

- `fediverse_flow`: 開始したブラウザーの印。他人の認証応答を踏ませてログインさせる攻撃を防ぐ。
- `fediverse_sign_up`: 登録の途中の鍵。

### セッションの発行

流れの判断は `services/auth/fediverse/signIn.ts` に置き、HTTP・DB・乱数・時刻は注入する。HTTP の口は Better Auth のプラグイン（`lib/fediverseSignInPlugin.ts`）にする。

- セッションとクッキーは Better Auth の `createSession` と `setSessionCookie` で発行する。そのため、既存のメールログインとクッキーの形・期限・取り消しが同じになる。
- POST の口は Better Auth の origin 確認を通るので、信頼しない Origin からは開始できない。
- 公開する口は [許可リスト](../../packages/backend/src/lib/authEndpoints.ts) に足す。
  - 固定のパス: `/fediverse/options`・`/fediverse/start`・`/fediverse/sign-up`
  - 末尾がホストの形のもの: `/fediverse/callback/<host>`・`/fediverse/client/<host>`

ホストは小文字の英数字・`.`・`-`・ポートだけ。そのままパスに入れ、エンコードしない（`%3A` にすると照合が崩れる）。

ユーザーと外部アカウントは同じトランザクションで作る。同じ外部アカウントで同時に登録されたら、どの一意制約の違反でも先に外部アカウントの持ち主を確かめ、既にいればその人でログインさせる（二重送信で 2 人にならない）。

### 外部への要求

ドメインは正規化し（IDN は punycode）、公開 HTTPS の接続先に限る。要求はすべて既存の [`safeFetch`](../../packages/backend/src/lib/safeFetch.ts) を `maxRedirects: 0` で使う。`safeFetch` は既定でリダイレクトを 3 回まで追い、POST の本文を次の宛先に送るので、0 を明示する。メタデータの 4xx は「未対応」、接続できなければ「接続できない」として扱う。コード・トークン・verifier はログに出さない。

Mastodon でアプリが無効（トークン交換が 401）なら、保存した登録を消して次回は登録し直す。ただし、相手が同意画面でエラーを出した場合は Ubichill に戻ってこないので、検出できない（既知の制約）。

### 設定（A は環境変数）

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `FEDIVERSE_SIGN_IN` | `on` | `off` で開始・応答・登録を止める。連携の記録は残るので、戻せば同じアカウントで入れる |
| `FEDIVERSE_SIGN_IN_SERVERS` | 空 | 使えるサーバーのホスト（カンマ区切り）。空ならすべて |
| `REGISTRATION` | `open` | `closed` で新規登録を止める（メール登録と SSO の両方）。既存ユーザーのログインと連携はできる |

連合で管理者が `block` にしたドメインは、開始・応答・登録の確定のどの時点でも断る。

開始は相手のサーバーへ要求を送るので、Better Auth のレート制限（本番のみ）で IP ごとに 10 回/分に絞る。登録の確定は 20 回/分。

### 信頼の前提

- 外部サーバーの管理者は、そのサーバーの誰にでもなりすませる。信頼できるサーバーに限りたい運用では `FEDIVERSE_SIGN_IN_SERVERS` を使う。
- ドメインが失効し、別人に取り直されると、同じ origin と ID で既存のユーザーとしてログインできうる。完全には防げない。管理者をメール必須にしたのは、この被害を管理者の権限に広げないためでもある。

## コントロールパネルの「認証」（B）

既存の[コントロールパネル](../../packages/frontend/src/components/hud/tabs/ControlPanelTab.tsx)に「認証」を足し、A の環境変数を画面から変えられるようにする。保存時に検証し、全 backend に反映する。反映は、変更時に既存の `backendEvents` で知らせ、各 backend は設定のリビジョンを見て読み直す。

| 項目 | 設定できること |
| --- | --- |
| ログイン方法 | メール・パスワード、フェディバースを個別に有効化。フェディバースは全サーバーか指定ドメインか |
| 新規登録 | 開く・閉じる |
| メール確認 | SSO 登録では任意、新規登録に必須、新規登録と次回ログインに必須 |

- 全方式の無効化は受け付けない。保存前に、ログイン手段を失うユーザーの数を出す。
- 設定は Postgres にリビジョン付きで置き、競合更新を検出する。直前の有効設定を残し、デプロイ権限の復旧コマンドで戻せるようにする。変更した項目・操作者・時刻を記録する。
- 書き込みには、既存の管理者判定（DB のセッションを確かめる）に加え、直近の再認証を求める。
  - 「直近の再認証」は今は無いので B で作る。再認証した時刻をセッションに記録し、10 分を目安にする。
  - 管理者はメール必須なので、再認証はパスワードで行える。
- 「新規登録と次回ログインに必須」には、連絡先メールの追加（確認コード）が先に要る。

## メール送信と Bot 保護（C）

### メール送信

現在は `RESEND_API_KEY` と `MAIL_FROM` で [Resend の HTTP API](../../packages/backend/src/lib/auth.ts) を使っている。C ではこれを共通の送信処理にまとめ、SMTP を選べるようにする。

- SMTP では証明書を検証し、暗号化を必須にする。
- 接続先は DNS で解決したアドレスを検査してから使い、TLS 証明書は元のホスト名に対して検証する。
- テスト送信では、失敗した段階（接続・認証・送信元）を返す。 [Resend の SMTP 設定](https://resend.com/docs/send-with-smtp)

### 秘密の値

SMTP のパスワードや API キーなどの秘密は、DB にはデプロイ側の鍵で暗号化して置く。鍵の世代を値に持たせ、前の鍵でも読めるようにしておく（連合の鍵の移行と同じ考え方）。鍵を失った場合は環境変数の送信設定に戻る。

### Bot 保護

Bot 保護はまず Cloudflare Turnstile だけにする。reCAPTCHA は GCP プロジェクトと評価 API が要り、障害点が増えるので、必要になってから足す。 [Turnstile のサーバー検証](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

- 検証はサーバーで行い、`hostname` と `action` を照合する。トークンは一度だけ使えるようにする。
- 検証サービスが応答しないときは保護対象の新規操作を止め、再試行できるエラーを返す。
- Bot 保護の有無にかかわらず、ログイン試行・SSO 開始・OTP のレート制限は適用する。

## 確認

A は次のテストで確かめている。

| 対象 | 内容 |
| --- | --- |
| `shared/account/fediverseSignIn.test.ts` | 入力の解釈、内部値と連絡先、ID・表示名の候補、戻り先の制限 |
| `services/auth/fediverse/signIn.test.ts` | 判定、state の使い回し・期限・別ブラウザー・別サーバー、`iss`、失効の失敗、block、初回登録、同時登録、別サーバーの同じ ID、連携のセッション |
| `lib/fediverseSignInPlugin.test.ts` | クッキーの属性と署名、セッション発行、origin 確認、client_id 文書 |
| `db/.../fediverseAccountRepository.integration.test.ts` | 同時登録で 1 人、同時解除で最後の 1 つが残る、改名の追従、一度だけ取り出す |
| `services/roles/roles.test.ts` | メールの無い人は管理者にできず、管理者にもならない |

手元では、自己署名の HTTPS で動く偽の Misskey（client_id の文書を実際に取得して redirect_uri を照合する）と、別ポートの backend・Vite を使い、Express の関門を含めて次を確かめた。

- 開始 → 同意 → 初回登録 → 元の部屋
- 再ログイン、応答の使い回し、印の無い応答、信頼しない Origin
- 最後の手段を外せないこと、メールなしユーザーが管理者でないこと

本物のサーバーでの確認は、PR に紐づく HTTPS プレビューで行う。Misskey は client_id の文書を取りに来るので、プレビューが外から届く必要がある。[PR プレビューの待機スクリプト](../../.github/scripts/wait-preview.sh) で起動を確かめてから、Mastodon と Misskey の実アカウントで次を通す。

- 招待からメールなしで登録し、元の部屋に戻る
- 再ログイン、既存ユーザーへの連携、外部での改名
- 最後の手段を外せないこと
