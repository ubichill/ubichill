/**
 * ユーザー ID（handle）と作者アカウント（`handle@domain`）の純粋な知識。
 *
 * - 表示名（users.name）は日本語・記号も可。VRChat のように一意で、検索に使う。変更できる。
 *   一意性は {@link displayNameKey}（全角半角・大文字小文字・空白の違いを同一視）で判定する。
 * - handle は URL・署名・機械処理用の ID。英小文字・数字・`_` の 3〜30 文字、一意、変更不可。
 * - 作者アカウントは `handle@domain`（例 `youkan@ubichill.com`）。表示は `@youkan@ubichill.com`。
 *   domain は handle を発行したサーバー（または作者自身のドメイン）で、WebFinger で公開鍵を引ける。
 */
import { z } from 'zod';

/**
 * WebFinger（JRD）の properties で表示名を載せるキー。作者名はワールドのデータに持たせず、
 * アカウントが存在するサーバーからその時点の表示名を引く（改名しても署名し直さなくてよい）。
 */
export const DISPLAY_NAME_WEBFINGER_PROPERTY = 'https://ubichill.com/ns/display-name';

export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

/**
 * 公式アカウントの ID。サーバー起動時に用意され、公式ワールドの作者（ubichill@<domain>）と
 * このサーバーの管理者を兼ねる。予約語なので一般の登録では取れない。
 */
export const OFFICIAL_HANDLE = 'ubichill';

/** 公式ワールドの作者アカウント（worlds/trusted-authors.json に鍵を記録してレビューする）。 */
export const OFFICIAL_WORLDS_AUTHOR = 'ubichill@ubichill.com';

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

export const DISPLAY_NAME_MAX_LENGTH = 30;

export const DisplayNameSchema = z
    .string()
    .trim()
    .min(1, '表示名を入力してください')
    .max(DISPLAY_NAME_MAX_LENGTH, `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内です`)
    .refine((v) => !isControlText(v), '表示名に制御文字は使えません');

function isControlText(value: string): boolean {
    return Array.from(value).some((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
    });
}

/**
 * 表示名の一意性判定キー。NFKC（全角英数→半角など）・前後空白除去・連続空白の圧縮・小文字化。
 * 「Youkan」「ｙｏｕｋａｎ」「youkan 」を同じ名前として扱い、見分けにくい重複を防ぐ。
 * DB の移行 SQL（lower(regexp_replace(btrim(normalize(name, NFKC)), '\s+', ' ', 'g'))）と同じ規則。
 */
export function displayNameKey(name: string): string {
    return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
