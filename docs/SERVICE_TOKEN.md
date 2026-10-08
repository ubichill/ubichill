# サービストークン — mod から外部サービスへの身元証明

mod が自分の外部サービス（API サーバー）を持つとき、サービスは「この依頼は Ubichill にログインしている利用者から
来た」ことを確かめたい。確かめられないと、サービスは誰でも使える公開 API になり、回数制限もかけられない。

サービストークンは、そのための短命の署名。形式は標準の **JWT（EdDSA / Ed25519）** なので、サービスは既存の
JWT ライブラリと発行元の公開鍵（JWKS）だけで検証できる。共有の秘密も、Ubichill への事前登録も要らない。

関連: [MOD_RUNTIME.md](./MOD_RUNTIME.md)（通信の境界）/ [CAPABILITIES.md](./CAPABILITIES.md)（権限 `identity:token`）

---

## 流れ

```
mod ── Ubi.identity.token('https://api.example.com') ──▶ Host（ドメイン承認と同じ規則で宛先を確認）
                                                         └─▶ Ubichill のサーバー（ログイン中のセッションで発行）
mod ── Ubi.fetch(url, { headers: { authorization: `Bearer ${token}` } }) ──▶ サービス
サービス ── 発行元の公開鍵（JWKS）で検証 ──▶ sub ごとに回数制限・利用記録
```

---

## mod 側

```ts
const API = 'https://api.example.com';

async function callApi(path: string) {
    const { token } = await Ubi.identity.token(API); // 期限の少し前まで使い回されるので毎回呼んでよい
    return Ubi.fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
}
```

- 宛先はサービスの**オリジン**（`https://api.example.com`。パスは付けない）。
- 宛先は `Ubi.fetch` と同じく、ユーザーが通信を許したドメインに限る（初回は承認画面が出る）。
- 権限 `identity:token`（dangerous）。mod の読み込み時にユーザーへ確認する。
- ゲスト・未ログイン・発行していないサーバーでは `IDENTITY_UNAVAILABLE` の UbiError。その場合の扱い
  （ログインを促す、機能を絞る）は mod が決める。古い Host には `Ubi.identity` が無いので、
  `Ubi.runtime.supports('identity')` で確かめる。

---

## トークンの中身

ヘッダー: `{ "alg": "EdDSA", "typ": "JWT", "kid": "<鍵の ID>" }`

| クレーム | 内容 |
| --- | --- |
| `iss` | 発行元の Ubichill の公開オリジン（例 `https://ubichill.example`） |
| `aud` | 宛先のサービスのオリジン。**ほかのサービスでは使えない** |
| `sub` | **サービスごとの仮名**。同じ人・同じサービスなら常に同じ。サービスが違えば別の値で、突き合わせられない |
| `mod` | 依頼した mod の ID（`video-player` など） |
| `iat` / `exp` | 発行時刻と期限（5 分） |
| `jti` | トークンごとの一意な値 |

本当のユーザー ID・メールアドレス・表示名は入らない。

---

## サービス側の検証

1. `Authorization: Bearer <token>` を受け取る。
2. **`iss` が信頼する発行元の一覧にあるか**を先に確かめる（一覧に無い発行元の鍵は取りに行かない）。
3. 発行元の公開鍵を `<iss>/api/v1/service-tokens/keys`（JWKS）から取得してキャッシュする。
   知らない `kid` が来たら取り直す（発行元が鍵を差し替えた場合）。
4. 署名（EdDSA のみ受け付ける）、`aud` が自分のオリジンか、`exp` / `iat`、必要なら `mod` を確かめる。
5. `sub` を利用者の識別子として、回数制限や利用記録に使う。

### Python（PyJWT）

```python
import jwt
from jwt import PyJWKClient

TRUSTED_ISSUERS = {"https://ubichill.example"}
AUDIENCE = "https://api.example.com"
_clients: dict[str, PyJWKClient] = {}

def verify(token: str) -> dict:
    issuer = jwt.decode(token, options={"verify_signature": False})["iss"]
    if issuer not in TRUSTED_ISSUERS:
        raise PermissionError("untrusted issuer")
    client = _clients.setdefault(issuer, PyJWKClient(f"{issuer}/api/v1/service-tokens/keys"))
    claims = jwt.decode(
        token,
        client.get_signing_key_from_jwt(token).key,
        algorithms=["EdDSA"],
        audience=AUDIENCE,
        issuer=issuer,
        options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        leeway=30,
    )
    if claims.get("mod") != "my-mod":
        raise PermissionError("unexpected mod")
    return claims
```

### Node.js（jose）

```ts
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

const TRUSTED_ISSUERS = new Set(['https://ubichill.example']);
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verify(token: string) {
    const { iss } = decodeJwt(token);
    if (!iss || !TRUSTED_ISSUERS.has(iss)) throw new Error('untrusted issuer');
    const keys = jwks.get(iss) ?? createRemoteJWKSet(new URL(`${iss}/api/v1/service-tokens/keys`));
    jwks.set(iss, keys);
    const { payload } = await jwtVerify(token, keys, {
        issuer: iss,
        audience: 'https://api.example.com',
        algorithms: ['EdDSA'],
        clockTolerance: 30,
    });
    return payload;
}
```

### 動画・画像など、ヘッダーを付けられない取得

`<video>` や `<img>` は `Authorization` ヘッダーを送れない。トークンを確かめた API の応答で、サービス自身が
**短命の署名付き URL**（例: `?exp=…&sig=HMAC(…)`）を発行し、メディアの取得ではその署名を確かめる。
トークンを URL に入れるのは避ける（ログやリファラーに残るため）。

---

## 何を守り、何を守らないか

| 守る | 守らない |
| --- | --- |
| Ubichill にログインしていない第三者がサービスを直接使うこと | ログインした利用者が、自分の権利の範囲でサービスを使い込むこと（サービス側で `sub` ごとに回数制限する） |
| 別のサービス宛てのトークンの流用（`aud`） | 利用者が自分のトークンを 5 分以内に別の場所で使うこと |
| サービス同士での利用者の突き合わせ（仮名） | 悪意ある mod が同じ ID（`mod`）を名乗ること（mod の ID は自己申告。lock で固定したワールドでのみ意味を持つ） |

---

## 発行元（Ubichill のサーバー）の設定

| env | 内容 |
| --- | --- |
| `SERVICE_TOKEN_SIGNING_KEY` | Ed25519 の PKCS8（PEM か base64）。`openssl genpkey -algorithm ed25519` で作る。全 Pod で同じ鍵にする |
| `PUBLIC_BASE_URL` | `iss` になる公開オリジン |
| `BETTER_AUTH_SECRET` | 仮名の計算に使う（署名鍵を差し替えても仮名が変わらないように、別の秘密から導く） |

- 本番で `SERVICE_TOKEN_SIGNING_KEY` が未設定なら発行しない（`503`）。開発では起動ごとに使い捨ての鍵を作る。
- 鍵を差し替えると、それまでのトークン（最長 5 分）は検証できなくなる。サービスは知らない `kid` で JWKS を取り直す。
- `POST /api/v1/service-tokens` はログイン必須で、1 人あたり毎分 60 回まで。
- 発行時は DB のセッションを確認する。ログアウト・失効後に認証の cookie キャッシュから新しいトークンを発行しない。
  発行済みのトークンは期限（最長 5 分）まで有効。
