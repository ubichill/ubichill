/**
 * author_keys の行と、リポジトリの外で使う形の変換（純粋。DB に触れない）。
 */
import { normalizeEd25519PublicKey, type RevokeReason } from '@ubichill/shared';
import type { authorKeys } from '../schema';

export type AuthorKeyRow = typeof authorKeys.$inferSelect;

/** 自サーバーの公開環境の鍵（origin = local の行）。CHECK 制約で user_id・kind・name は必ずある。 */
export interface LocalAuthorKeyRecord {
    id: string;
    userId: string;
    kind: string;
    name: string;
    publicKey: string;
    apiTokenHash: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    revokeReason: RevokeReason | null;
}

export function localKeyOf(row: AuthorKeyRow): LocalAuthorKeyRecord {
    if (row.origin !== 'local' || row.userId === null || row.kind === null || row.name === null) {
        throw new Error(`author_keys ${row.id} は自サーバーの鍵ではありません`);
    }
    return {
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        name: row.name,
        publicKey: row.publicKey,
        apiTokenHash: row.apiTokenHash,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
        revokeReason: row.revokeReason === 'lost' || row.revokeReason === 'compromised' ? row.revokeReason : null,
    };
}

/** 他サーバーの鍵一覧の 1 件（取得した文書の形）。 */
export interface FetchedSigningKey {
    publicKey: string;
    addedAt?: string;
    revokedAt?: string;
}

export interface RemoteKeyRow {
    publicKey: string;
    createdAt: Date;
    revokedAt: Date | null;
}

const parseDate = (value: string | undefined): Date | undefined => {
    if (value === undefined) return undefined;
    const time = Date.parse(value);
    return Number.isNaN(time) ? undefined : new Date(time);
};

const earliest = (a: Date | null, b: Date | null): Date | null => {
    if (!a) return b;
    if (!b) return a;
    return a.getTime() <= b.getTime() ? a : b;
};

/**
 * 取得した鍵一覧を保存する行にする。鍵は正規化し、読めない鍵は捨てる。
 * 正規化して重なる鍵は 1 行にまとめ、どれか 1 つでも取り消されていれば取り消し（shared の signingKeyStatus と同じ）。
 * 取り消しの時刻が読めなければ確認時刻で取り消す（読めないことで有効に戻さない）。マイグレーション 0020 と同じ規則。
 */
export function remoteKeyRowsOf(keys: readonly FetchedSigningKey[], fetchedAt: Date): RemoteKeyRow[] {
    const merged = keys.reduce((acc, key) => {
        const publicKey = normalizeEd25519PublicKey(key.publicKey);
        if (!publicKey) return acc;
        const addedAt = parseDate(key.addedAt) ?? null;
        const revokedAt = key.revokedAt === undefined ? null : (parseDate(key.revokedAt) ?? fetchedAt);
        const prev = acc.get(publicKey);
        return acc.set(
            publicKey,
            prev
                ? { addedAt: earliest(prev.addedAt, addedAt), revokedAt: earliest(prev.revokedAt, revokedAt) }
                : { addedAt, revokedAt },
        );
    }, new Map<string, { addedAt: Date | null; revokedAt: Date | null }>());
    return [...merged].map(([publicKey, { addedAt, revokedAt }]) => ({
        publicKey,
        createdAt: addedAt ?? fetchedAt,
        revokedAt,
    }));
}
