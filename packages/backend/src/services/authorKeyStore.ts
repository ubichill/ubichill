/**
 * 作者アカウント → 公開鍵・表示名の解決器の実体（DB・safeFetch を注入して組み立てる）。
 * どの作者も同じ規則で確かめる（公式アカウントも、リポジトリの記録で特別に信用しない）。
 * ロジックは authorKeys.ts（DB 非依存でテストできる）。
 */
import { authorBindingRepository, publishingEnvironmentRepository, userRepository } from '@ubichill/db';
import type { AuthorKeyCheck } from '@ubichill/shared';
import { createAuthorKeyDirectory, selfDomain } from './authorKeys';
import { signingKeyEntryOf } from './publishingEnvironments';
import { safeFetch } from './safeFetch';

const authorKeys = createAuthorKeyDirectory({
    selfDomain,
    findLocalAccount: async (handle) => {
        const user = await userRepository.findByHandle(handle);
        if (!user) return undefined;
        const environments = await publishingEnvironmentRepository.listByUser(user.id);
        return { keys: environments.map(signingKeyEntryOf), displayName: user.name };
    },
    bindings: {
        find: async (account) => {
            const record = await authorBindingRepository.find(account);
            return record
                ? { keys: record.keys, displayName: record.displayName ?? undefined, fetchedAt: record.fetchedAt }
                : undefined;
        },
        save: (account, profile) => authorBindingRepository.save(account, [...profile.keys], profile.displayName),
    },
    confirmedContents: {
        record: (account, contentHash) => authorBindingRepository.recordConfirmedContent(account, contentHash),
        has: (account, contentHash) => authorBindingRepository.hasConfirmedContent(account, contentHash),
    },
    fetchJson: async (url) => {
        const res = await safeFetch(url, {
            headers: { Accept: 'application/jrd+json, application/json' },
            signal: AbortSignal.timeout(5000),
        });
        return res.ok ? ((await res.json()) as unknown) : undefined;
    },
    allowHttp: process.env.WORLDS_FETCH_ALLOW_PRIVATE === 'true',
});

/**
 * 署名検証で使う作者の確認。DB エラーなどの例外は pending として扱われ、30 秒ごとに確認し直し続けるので、
 * 障害に気付けるようログを出す。
 */
export const isAuthorKey: AuthorKeyCheck = (author, publicKey, contentHash) =>
    authorKeys.isAuthorKey(author, publicKey, contentHash).catch((err: unknown) => {
        console.error(`❌ 作者の確認に失敗しました（pending として扱う）: ${author}`, err);
        return { status: 'pending' } as const;
    });
export const resolveAuthorDisplayName = authorKeys.displayName;
export const invalidateAuthorKey = authorKeys.invalidate;
