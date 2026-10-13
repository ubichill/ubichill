/**
 * 署名の土台（純粋）: 正規化した JSON と、注入する暗号・作者の確認の型。ワールド・mod など、どの種類の署名も同じものを使う。
 */

export interface WorldCrypto {
    /** UTF-8 文字列の sha256 を標準 base64 で返す。 */
    sha256Base64(text: string): Promise<string>;
    /** ed25519 検証。鍵・署名は base64url。不正な鍵・署名は throw せず false を返すこと。 */
    verifyEd25519(publicKey: string, message: string, signature: string): Promise<boolean>;
}

export interface WorldSigningKey {
    /** base64url の ed25519 公開鍵。 */
    readonly publicKey: string;
    /** UTF-8 文字列に署名し base64url を返す。 */
    sign(message: string): Promise<string>;
}

function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * RFC 8785 (JCS) 相当の正規化 JSON。キーは UTF-16 コード単位順、空白無し。
 * `JSON.stringify` と同じく object の undefined 値は落とし、配列内の undefined は null にする。
 * 非有限数・Date/Map 等の非プレーン object・bigint 等は署名対象として曖昧なので throw する。
 */
export function canonicalJson(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) throw new TypeError(`正規化できない数値: ${value}`);
            return JSON.stringify(value);
        case 'string':
            return JSON.stringify(value);
        case 'object': {
            if (Array.isArray(value)) {
                return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
            }
            if (!isPlainObject(value)) throw new TypeError('正規化できない object（プレーン object のみ可）');
            const entries = Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
        }
        default:
            throw new TypeError(`正規化できない値の型: ${typeof value}`);
    }
}

/**
 * `publicKey` が作者アカウント（`handle@domain`）の取り消されていない公開環境の鍵かの判定結果。
 * - confirmed: 有効な鍵。`checkedAt` は他サーバーの鍵一覧を最後に確認できた時刻（自サーバー・記録済みでは無し）
 * - unconfirmed: 一覧に無い・取り消し済み・アカウントが無い
 * - pending: いまは確認できない（取得の上限などで取りに行かなかった）。作者は付けず、すぐ確認し直す
 */
export type AuthorKeyCheckResult =
    | { status: 'confirmed'; checkedAt?: string }
    | { status: 'unconfirmed' }
    | { status: 'pending' };

/**
 * 1 アカウントは複数の鍵を持つので、署名に使われた鍵を渡して判定させる
 * （自サーバーは DB、他ドメインは WebFinger から辿る鍵一覧）。`contentHash` は、作者の確認が古い間に
 * 「古くなる前に確認済みだった内容」にだけ作者を付けるために渡す。
 */
export type AuthorKeyCheck = (author: string, publicKey: string, contentHash: string) => Promise<AuthorKeyCheckResult>;
