/**
 * 作者アカウント（handle@domain）→ 署名公開鍵の解決。
 *
 * - 自サーバーの domain（PUBLIC_BASE_URL のホスト）なら DB から引く。
 * - 他の domain は `https://<domain>/.well-known/webfinger?resource=acct:handle@domain` の JRD から引く
 *   （Mastodon 等と同じ標準。作者が自分のドメインで公開すれば、特定のサーバーに依存しない）。
 * 取得結果は TTL キャッシュする。鍵を登録・変更したら {@link invalidateAuthorKey} で消す。
 */
import { userRepository } from '@ubichill/db';
import {
    Ed25519PublicKeySchema,
    ENV_KEYS,
    formatAuthorAccount,
    parseAuthorAccount,
    SERVER_CONFIG,
    SIGNING_KEY_WEBFINGER_PROPERTY,
} from '@ubichill/shared';
import { safeFetch } from './safeFetch';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; key: string | undefined }>();

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

async function fetchWebFingerKey(account: string, domain: string): Promise<string | undefined> {
    const path = `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${account}`)}`;
    // 本番は https のみ。開発（WORLDS_FETCH_ALLOW_PRIVATE）では localhost 間の http も試す。
    const schemes = process.env.WORLDS_FETCH_ALLOW_PRIVATE === 'true' ? ['https', 'http'] : ['https'];
    for (const scheme of schemes) {
        try {
            const res = await safeFetch(`${scheme}://${domain}${path}`, {
                headers: { Accept: 'application/jrd+json, application/json' },
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) return publicKeyFromWebFinger(await res.json(), account);
        } catch {
            // 次の scheme を試す
        }
    }
    return undefined;
}

/** 作者アカウントの現在の署名公開鍵。見つからなければ undefined（作者として表示しない）。 */
export async function resolveAuthorKey(author: string): Promise<string | undefined> {
    const parsed = parseAuthorAccount(author);
    if (!parsed) return undefined;
    const account = formatAuthorAccount(parsed);
    const cached = cache.get(account);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.key;

    const key =
        parsed.domain === selfDomain()
            ? ((await userRepository.findByHandle(parsed.handle))?.signingPublicKey ?? undefined)
            : await fetchWebFingerKey(account, parsed.domain);
    cache.set(account, { at: Date.now(), key });
    return key;
}

export function invalidateAuthorKey(author: string): void {
    const parsed = parseAuthorAccount(author);
    if (parsed) cache.delete(formatAuthorAccount(parsed));
}
