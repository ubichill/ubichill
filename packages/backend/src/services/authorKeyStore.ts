/**
 * 作者アカウント → 公開鍵・表示名の解決器の実体（DB・safeFetch を注入して組み立てる）。
 * どの作者も同じ規則で確かめる（公式アカウントも、リポジトリの記録で特別に信用しない）。
 * 規則は @ubichill/shared の authorKeyDirectory（ブラウザの Host と同じ。DB 非依存でテストできる）。
 */
import { authorKeyRepository, userRepository } from '@ubichill/db';
import { type AuthorKeyCheck, createAuthorKeyDirectory } from '@ubichill/shared';
import { authorKeySources, withNormalizedKey } from './authorKeySources';
import { selfDomain } from './authorKeys';
import { safeFetch } from './safeFetch';

const { findLocalAccount, bindings, confirmedContents } = authorKeySources({
    repository: authorKeyRepository,
    findUserByHandle: (handle) => userRepository.findByHandle(handle),
    warn: (message) => console.warn(message),
});

const authorKeys = createAuthorKeyDirectory({
    local: { domain: selfDomain, findAccount: findLocalAccount },
    bindings,
    confirmedContents,
    fetchJson: async (url) => {
        const res = await safeFetch(url, {
            headers: { Accept: 'application/jrd+json, application/json' },
            signal: AbortSignal.timeout(5000),
        });
        return res.ok ? ((await res.json()) as unknown) : undefined;
    },
    allowHttp: process.env.WORLDS_FETCH_ALLOW_PRIVATE === 'true',
});

const checkAuthorKey = withNormalizedKey(authorKeys.isAuthorKey);

/**
 * 署名検証で使う作者の確認。DB エラーなどの例外は pending として扱われ、30 秒ごとに確認し直し続けるので、
 * 障害に気付けるようログを出す。
 */
export const isAuthorKey: AuthorKeyCheck = (author, publicKey, contentHash) =>
    checkAuthorKey(author, publicKey, contentHash).catch((err: unknown) => {
        console.error(`❌ 作者の確認に失敗しました（pending として扱う）: ${author}`, err);
        return { status: 'pending' } as const;
    });
export const resolveAuthorDisplayName = authorKeys.displayName;
export const invalidateAuthorKey = authorKeys.invalidate;
