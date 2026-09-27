/**
 * 作者アカウント（handle@domain）→ 署名公開鍵の解決（DB・ネットワーク非依存）。
 *
 * - 自サーバーの domain（PUBLIC_BASE_URL のホスト）なら注入された `findLocalKey`（DB）で引く。
 * - 他の domain は `https://<domain>/.well-known/webfinger?resource=acct:handle@domain` の JRD から引く
 *   （Mastodon 等と同じ標準。作者が自分のドメインで公開すれば、特定のサーバーに依存しない）。
 * 取得結果は TTL キャッシュする。実体の組み立て（DB・safeFetch）は authorKeyStore.ts。
 */
import {
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

/**
 * WebFinger の JRD から、指定アカウントの署名公開鍵を取り出す（純粋）。
 * subject が問い合わせたアカウントと一致しない応答（別人の JRD を返すなど）は採用しない。
 */
export function publicKeyFromWebFinger(jrd: unknown, account: string): string | undefined {
    if (typeof jrd !== 'object' || jrd === null) return undefined;
    const { subject, properties } = jrd as { subject?: unknown; properties?: unknown };
    const expected = parseAuthorAccount(account);
    const actual = typeof subject === 'string' ? parseAuthorAccount(subject) : null;
    if (!expected || !actual || formatAuthorAccount(expected) !== formatAuthorAccount(actual)) return undefined;
    if (typeof properties !== 'object' || properties === null) return undefined;
    const key = (properties as Record<string, unknown>)[SIGNING_KEY_WEBFINGER_PROPERTY];
    return Ed25519PublicKeySchema.safeParse(key).success ? (key as string) : undefined;
}

export interface AuthorKeyDirectoryDeps {
    selfDomain: () => string;
    /** 自サーバーのユーザーの登録公開鍵（DB）。 */
    findLocalKey: (handle: string) => Promise<string | undefined>;
    /** WebFinger の取得。失敗・非 2xx は undefined を返すこと。 */
    fetchJson: (url: string) => Promise<unknown>;
    /** 開発（localhost 間）だけ http も試す。本番は https のみ。 */
    allowHttp: boolean;
    now?: () => number;
}

export interface AuthorKeyDirectory {
    resolve: (author: string) => Promise<string | undefined>;
    invalidate: (author: string) => void;
}

export function createAuthorKeyDirectory(deps: AuthorKeyDirectoryDeps): AuthorKeyDirectory {
    const now = deps.now ?? Date.now;
    const cache = new Map<string, { at: number; key: string | undefined }>();

    const fetchWebFingerKey = async (account: string, domain: string): Promise<string | undefined> => {
        const path = `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${account}`)}`;
        const schemes = deps.allowHttp ? ['https', 'http'] : ['https'];
        const found = await schemes.reduce<Promise<string | undefined>>(
            async (prev, scheme) =>
                (await prev) ??
                publicKeyFromWebFinger(
                    await deps.fetchJson(`${scheme}://${domain}${path}`).catch(() => undefined),
                    account,
                ),
            Promise.resolve(undefined),
        );
        return found;
    };

    return {
        async resolve(author) {
            const parsed = parseAuthorAccount(author);
            if (!parsed) return undefined;
            const account = formatAuthorAccount(parsed);
            const cached = cache.get(account);
            if (cached && now() - cached.at < TTL_MS) return cached.key;

            const key =
                parsed.domain === deps.selfDomain()
                    ? await deps.findLocalKey(parsed.handle)
                    : await fetchWebFingerKey(account, parsed.domain);
            cache.set(account, { at: now(), key });
            return key;
        },
        invalidate(author) {
            const parsed = parseAuthorAccount(author);
            if (parsed) cache.delete(formatAuthorAccount(parsed));
        },
    };
}
