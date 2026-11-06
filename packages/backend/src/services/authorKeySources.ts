/**
 * 作者の確認（shared の authorKeyDirectory）に渡す、DB の読み書き。リポジトリと利用者の引き方を注入する
 * （本番は authorKeyStore.ts、移行の結合テストは別の DB のリポジトリで同じものを組み立てる）。
 */
import type { AuthorKeyRepository } from '@ubichill/db';
import { type AuthorKeyCheck, type AuthorKeyDirectoryDeps, normalizeEd25519PublicKey } from '@ubichill/shared';
import { claimedLocalKeysWarning, remoteKeyEntriesOf } from './authorKeys';
import { signingKeyEntryOf } from './publishingEnvironments';

/** 保存した鍵は正規化してあるので、署名の鍵も正規化してから照合する。読めない鍵は作者を付けない。 */
export function withNormalizedKey(check: AuthorKeyCheck): AuthorKeyCheck {
    return async (author, publicKey, contentHash) => {
        const normalized = normalizeEd25519PublicKey(publicKey);
        return normalized ? check(author, normalized, contentHash) : { status: 'unconfirmed' };
    };
}

export interface AuthorKeySourceDeps {
    repository: AuthorKeyRepository;
    findUserByHandle: (handle: string) => Promise<{ id: string; name: string } | undefined>;
    warn: (message: string) => void;
}

export function authorKeySources(deps: AuthorKeySourceDeps): Pick<
    AuthorKeyDirectoryDeps,
    'bindings' | 'confirmedContents'
> & {
    findLocalAccount: NonNullable<AuthorKeyDirectoryDeps['local']>['findAccount'];
} {
    const { repository } = deps;
    return {
        findLocalAccount: async (handle) => {
            const user = await deps.findUserByHandle(handle);
            if (!user) return undefined;
            const environments = await repository.listByUser(user.id);
            return { keys: environments.map(signingKeyEntryOf), displayName: user.name };
        },
        bindings: {
            find: async (account) => {
                const record = await repository.findRemoteAuthor(account);
                return record
                    ? {
                          keys: remoteKeyEntriesOf(record.keys, record.fetchedAt),
                          displayName: record.displayName ?? undefined,
                          fetchedAt: record.fetchedAt,
                      }
                    : undefined;
            },
            save: async (account, profile) => {
                const { claimedLocalKeys } = await repository.saveRemoteAuthor(account, profile);
                const warning = claimedLocalKeysWarning(account, claimedLocalKeys);
                if (warning) deps.warn(warning);
            },
        },
        confirmedContents: {
            record: (account, contentHash) => repository.recordConfirmedContent(account, contentHash),
            has: (account, contentHash) => repository.hasConfirmedContent(account, contentHash),
        },
    };
}
