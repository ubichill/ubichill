/**
 * better-auth のエンドポイントのうち、HTTP から呼んでよいもの。
 *
 * それ以外はサーバー内から `auth.api.*` で呼ぶだけにする。better-auth は既定で多くの口を開けており、
 * 例えば `/sign-up/email` はメール確認（OTP）を通らずにアカウントを作れ、`/update-user` は表示名の一意性と
 * 変更間隔を迂回できる。ライブラリの更新で口が増えても開かないよう、塞ぐものではなく通すものを列挙する。
 */
const PUBLIC_AUTH_PATHS: ReadonlySet<string> = new Set([
    '/sign-in/email',
    '/sign-out',
    '/get-session',
    // 公式アカウントは blockOfficialPasswordChange が別に止める
    '/change-password',
    '/ok',
    '/error',
    // フェディバースのログイン（lib/fediverseSignInPlugin.ts）
    '/fediverse/options',
    '/fediverse/start',
    '/fediverse/sign-up',
    '/fediverse/lookup',
]);

/** 最後の 1 段がサーバーのホスト（`/fediverse/callback/mi.example`）のもの。ホストの形でなければ通さない。 */
const PUBLIC_AUTH_PATH_PATTERNS: readonly RegExp[] = [
    /^\/fediverse\/(callback|client)\/[a-z0-9][a-z0-9.-]*(:\d{1,5})?$/,
];

/** `/api/auth` より後ろのパス（`req.path`）が HTTP から呼んでよいものか。大文字小文字・末尾の `/` の違いでもすり抜けさせない。 */
export function isPublicAuthPath(path: string): boolean {
    const normalized = path.replace(/\/+$/, '');
    return PUBLIC_AUTH_PATHS.has(normalized) || PUBLIC_AUTH_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}
