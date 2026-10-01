/**
 * 作者アカウント → 公開鍵・表示名の解決器の実体（DB・safeFetch・リポジトリの記録を注入して組み立てる）。
 * ロジックは authorKeys.ts（DB 非依存でテストできる）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBindingRepository, publishingEnvironmentRepository, userRepository } from '@ubichill/db';
import {
    type AuthorKeyCheck,
    ENV_KEYS,
    formatAuthorAccount,
    parseAuthorAccount,
    SERVER_CONFIG,
    type SigningKeyEntry,
    SigningKeyEntrySchema,
} from '@ubichill/shared';
import { z } from 'zod';
import { type AuthorProfile, createAuthorKeyDirectory, selfDomain } from './authorKeys';
import { signingKeyEntryOf } from './publishingEnvironments';
import { safeFetch } from './safeFetch';

/**
 * `worlds/trusted-authors.json`（リポジトリで管理しレビューされる、確認済みの作者アカウントと鍵一覧）を読む。
 * 公式ワールドの作者（ubichill@ubichill.com）の確認をオフライン・開発環境でも行えるようにする。
 * 形式: `{ "authors": { "handle@domain": { "displayName": "...", "keys": [{ "publicKey": "...", "revokedAt"?: "..." }] } } }`
 */
export function loadPinnedAuthors(filePath: string): Map<string, AuthorProfile> {
    if (!fs.existsSync(filePath)) return new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { authors?: Record<string, unknown> };
        return new Map(
            Object.entries(raw.authors ?? {}).flatMap(([author, value]) => {
                const account = parseAuthorAccount(author);
                const entry = value as { keys?: unknown; displayName?: unknown };
                const keys = z.array(SigningKeyEntrySchema).safeParse(entry.keys);
                if (!account || !keys.success) return [];
                const displayName = typeof entry.displayName === 'string' ? entry.displayName : undefined;
                return [[formatAuthorAccount(account), { keys: keys.data, displayName }] as const];
            }),
        );
    } catch {
        console.error(`❌ ${filePath} を読めません（確認済み作者の記録を使わずに続行）`);
        return new Map();
    }
}

const worldsDir = process.env[ENV_KEYS.WORLDS_DIR]
    ? path.resolve(process.env[ENV_KEYS.WORLDS_DIR] as string)
    : path.resolve(process.cwd(), SERVER_CONFIG.WORLDS_DIR_DEFAULT);

const pinnedAuthors = loadPinnedAuthors(path.join(worldsDir, 'trusted-authors.json'));

/** レビュー済みの記録にある作者アカウントの鍵一覧（公式アカウントの初期化に使う）。 */
export function pinnedAuthorKeys(account: string): readonly SigningKeyEntry[] {
    return pinnedAuthors.get(account)?.keys ?? [];
}

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
    pinned: pinnedAuthors,
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
