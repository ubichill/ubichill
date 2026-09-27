/**
 * 作者アカウント → 公開鍵・表示名の解決器の実体（DB・safeFetch・リポジトリの記録を注入して組み立てる）。
 * ロジックは authorKeys.ts（DB 非依存でテストできる）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBindingRepository, userRepository } from '@ubichill/db';
import {
    Ed25519PublicKeySchema,
    ENV_KEYS,
    formatAuthorAccount,
    parseAuthorAccount,
    SERVER_CONFIG,
} from '@ubichill/shared';
import { createAuthorKeyDirectory, selfDomain } from './authorKeys';
import { safeFetch } from './safeFetch';

/**
 * `worlds/trusted-authors.json`（リポジトリで管理しレビューされる、確認済みの作者アカウントと鍵）を読む。
 * 公式ワールドの作者（ubichill@ubichill.com）の確認をオフライン・開発環境でも行えるようにする。
 * 形式: `{ "authors": { "handle@domain": { "publicKey": "...", "displayName": "..." } } }`
 */
export function loadPinnedAuthors(filePath: string): Map<string, { signingPublicKey: string; displayName?: string }> {
    if (!fs.existsSync(filePath)) return new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { authors?: Record<string, unknown> };
        return new Map(
            Object.entries(raw.authors ?? {}).flatMap(([author, value]) => {
                const account = parseAuthorAccount(author);
                const entry = value as { publicKey?: unknown; displayName?: unknown };
                const key = Ed25519PublicKeySchema.safeParse(entry.publicKey);
                if (!account || !key.success) return [];
                const displayName = typeof entry.displayName === 'string' ? entry.displayName : undefined;
                return [[formatAuthorAccount(account), { signingPublicKey: key.data, displayName }] as const];
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

const authorKeys = createAuthorKeyDirectory({
    selfDomain,
    findLocalAccount: async (handle) => {
        const user = await userRepository.findByHandle(handle);
        return user
            ? { ...(user.signingPublicKey ? { signingPublicKey: user.signingPublicKey } : {}), displayName: user.name }
            : undefined;
    },
    bindings: {
        find: async (account) => {
            const record = await authorBindingRepository.find(account);
            return record
                ? { publicKey: record.publicKey, displayName: record.displayName, refreshedAt: record.refreshedAt }
                : undefined;
        },
        save: (account, publicKey, displayName) => authorBindingRepository.save(account, publicKey, displayName),
        refreshDisplayName: (account, displayName) => authorBindingRepository.refreshDisplayName(account, displayName),
    },
    pinned: loadPinnedAuthors(path.join(worldsDir, 'trusted-authors.json')),
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
export const resolveAuthorDisplayName = authorKeys.displayName;
export const invalidateAuthorKey = authorKeys.invalidate;
