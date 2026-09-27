/**
 * 作者アカウント（handle@domain）→ 署名公開鍵・表示名の解決（DB・ネットワーク非依存）。
 *
 * - 自サーバーの domain（PUBLIC_BASE_URL のホスト）なら注入された `findLocalKey`（DB）で引く。
 * - 他の domain は `https://<domain>/.well-known/webfinger?resource=acct:handle@domain` の JRD から引く
 *   （Mastodon 等と同じ標準。作者が自分のドメインで公開すれば、特定のサーバーに依存しない）。
 * 取得結果は TTL キャッシュする。実体の組み立て（DB・safeFetch）は authorKeyStore.ts。
 */
import {
    DISPLAY_NAME_WEBFINGER_PROPERTY,
    DisplayNameSchema,
    Ed25519PublicKeySchema,
    ENV_KEYS,
    formatAuthorAccount,
    parseAuthorAccount,
    SERVER_CONFIG,
    SIGNING_KEY_WEBFINGER_PROPERTY,
} from '@ubichill/shared';

const TTL_MS = 5 * 60 * 1000;

/** このサーバーが発行する作者アカウントの domain（ホスト名、開発時はポート付き）。 */
export function selfDomain(): string {
    const base = process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL;
    return new URL(base).host.toLowerCase();
}

export function selfAccount(handle: string): string {
    return formatAuthorAccount({ handle, domain: selfDomain() });
}

/** アカウントが存在するサーバーが公開している、その時点の作者情報。 */
export interface AuthorProfile {
    signingPublicKey?: string;
    displayName?: string;
}

/**
 * WebFinger の JRD から、指定アカウントの作者情報（署名公開鍵・表示名）を取り出す（純粋）。
 * subject が問い合わせたアカウントと一致しない応答（別人の JRD を返すなど）は採用しない。
 * 形式が不正な項目は捨てる（表示名に制御文字・長すぎる文字列を入れられても表示しない）。
 */
export function profileFromWebFinger(jrd: unknown, account: string): AuthorProfile | undefined {
    if (typeof jrd !== 'object' || jrd === null) return undefined;
    const { subject, properties } = jrd as { subject?: unknown; properties?: unknown };
    const expected = parseAuthorAccount(account);
    const actual = typeof subject === 'string' ? parseAuthorAccount(subject) : null;
    if (!expected || !actual || formatAuthorAccount(expected) !== formatAuthorAccount(actual)) return undefined;
    if (typeof properties !== 'object' || properties === null) return {};
    const props = properties as Record<string, unknown>;
    const key = Ed25519PublicKeySchema.safeParse(props[SIGNING_KEY_WEBFINGER_PROPERTY]);
    const name = DisplayNameSchema.safeParse(props[DISPLAY_NAME_WEBFINGER_PROPERTY]);
    return {
        ...(key.success ? { signingPublicKey: key.data } : {}),
        ...(name.success ? { displayName: name.data } : {}),
    };
}

export interface AuthorKeyDirectoryDeps {
    selfDomain: () => string;
    /** 自サーバーのユーザーの作者情報（DB）。存在しなければ undefined。 */
    findLocalAccount: (handle: string) => Promise<AuthorProfile | undefined>;
    /** WebFinger の取得。失敗・非 2xx は undefined を返すこと。 */
    fetchJson: (url: string) => Promise<unknown>;
    /** 開発（localhost 間）だけ http も試す。本番は https のみ。 */
    allowHttp: boolean;
    now?: () => number;
}

export interface AuthorKeyDirectory {
    /** 署名公開鍵（署名検証用）。 */
    resolve: (author: string) => Promise<string | undefined>;
    /** その時点の表示名。アカウントが見つからなければ undefined（作者名を表示しない）。 */
    displayName: (author: string) => Promise<string | undefined>;
    invalidate: (author: string) => void;
}

export function createAuthorKeyDirectory(deps: AuthorKeyDirectoryDeps): AuthorKeyDirectory {
    const now = deps.now ?? Date.now;
    const cache = new Map<string, { at: number; profile: AuthorProfile | undefined }>();

    const fetchWebFinger = async (account: string, domain: string): Promise<AuthorProfile | undefined> => {
        const path = `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${account}`)}`;
        const schemes = deps.allowHttp ? ['https', 'http'] : ['https'];
        return schemes.reduce<Promise<AuthorProfile | undefined>>(
            async (prev, scheme) =>
                (await prev) ??
                profileFromWebFinger(
                    await deps.fetchJson(`${scheme}://${domain}${path}`).catch(() => undefined),
                    account,
                ),
            Promise.resolve(undefined),
        );
    };

    const profileOf = async (author: string): Promise<AuthorProfile | undefined> => {
        const parsed = parseAuthorAccount(author);
        if (!parsed) return undefined;
        const account = formatAuthorAccount(parsed);
        const cached = cache.get(account);
        if (cached && now() - cached.at < TTL_MS) return cached.profile;

        const profile =
            parsed.domain === deps.selfDomain()
                ? await deps.findLocalAccount(parsed.handle)
                : await fetchWebFinger(account, parsed.domain);
        cache.set(account, { at: now(), profile });
        return profile;
    };

    return {
        resolve: async (author) => (await profileOf(author))?.signingPublicKey,
        displayName: async (author) => (await profileOf(author))?.displayName,
        invalidate(author) {
            const parsed = parseAuthorAccount(author);
            if (parsed) cache.delete(formatAuthorAccount(parsed));
        },
    };
}
