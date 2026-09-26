/**
 * ユーザー ID（handle）と作者アカウント（`handle@domain`）の純粋な知識。
 *
 * - 表示名（users.name）は日本語・記号も可で重複してよい。人に見せるための名前。
 * - handle は URL・署名・機械処理用の ID。英小文字・数字・`_` の 3〜30 文字、一意、変更不可。
 * - 作者アカウントは `handle@domain`（例 `youkan@ubichill.com`）。表示は `@youkan@ubichill.com`。
 *   domain は handle を発行したサーバー（または作者自身のドメイン）で、WebFinger で公開鍵を引ける。
 */
import { z } from 'zod';

/** WebFinger（JRD）の properties で作者署名の公開鍵を載せるキー。 */
export const SIGNING_KEY_WEBFINGER_PROPERTY = 'https://ubichill.com/ns/ed25519-signing-key';

export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

/** 運営・システム・URL と紛らわしい ID は取らせない。 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
    'admin',
    'administrator',
    'api',
    'app',
    'auth',
    'help',
    'mod',
    'mods',
    'moderator',
    'official',
    'root',
    'security',
    'settings',
    'support',
    'system',
    'ubichill',
    'user',
    'users',
    'webmaster',
    'world',
    'worlds',
    'www',
]);

export const HandleSchema = z
    .string()
    .regex(HANDLE_PATTERN, 'ID は英小文字・数字・_ の 3〜30 文字です')
    .refine((h) => !RESERVED_HANDLES.has(h), 'この ID は使用できません');

/** domain は小文字ホスト名（開発用にポート可）。 */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

export const AuthorAccountSchema = z
    .string()
    .max(300)
    .refine((v) => parseAuthorAccount(v) !== null, '作者アカウントは handle@domain の形式です');

export interface AuthorAccount {
    handle: string;
    domain: string;
}

/** `handle@domain`（先頭の `@` と `acct:` は許容）を分解する。不正なら null。 */
export function parseAuthorAccount(input: string): AuthorAccount | null {
    const bare = input
        .trim()
        .replace(/^acct:/, '')
        .replace(/^@/, '');
    const at = bare.lastIndexOf('@');
    if (at <= 0) return null;
    const handle = bare.slice(0, at);
    const domain = bare.slice(at + 1).toLowerCase();
    if (!HANDLE_PATTERN.test(handle) || !DOMAIN_PATTERN.test(domain)) return null;
    return { handle, domain };
}

export function formatAuthorAccount({ handle, domain }: AuthorAccount): string {
    return `${handle}@${domain.toLowerCase()}`;
}

/** 画面表示用（メールアドレスと区別するため先頭に `@` を付ける）。 */
export function displayAuthorAccount(account: string): string {
    return `@${account}`;
}
