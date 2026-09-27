/**
 * 作者アカウント → 公開鍵の解決器の実体（DB と safeFetch を注入して組み立てる）。
 * ロジックは authorKeys.ts（DB 非依存でテストできる）。
 */
import { userRepository } from '@ubichill/db';
import { createAuthorKeyDirectory, selfDomain } from './authorKeys';
import { safeFetch } from './safeFetch';

const authorKeys = createAuthorKeyDirectory({
    selfDomain,
    findLocalKey: async (handle) => (await userRepository.findByHandle(handle))?.signingPublicKey ?? undefined,
    fetchJson: async (url) => {
        const res = await safeFetch(url, {
            headers: { Accept: 'application/jrd+json, application/json' },
            signal: AbortSignal.timeout(5000),
        });
        return res.ok ? ((await res.json()) as unknown) : undefined;
    },
    allowHttp: process.env.WORLDS_FETCH_ALLOW_PRIVATE === 'true',
});

export const resolveAuthorKey = authorKeys.resolve;
export const invalidateAuthorKey = authorKeys.invalidate;
