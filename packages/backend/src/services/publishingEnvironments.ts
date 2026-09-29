/**
 * 公開環境（作者アカウントの署名鍵）の純粋なロジック。DB の読み書きは routes / officialAccountStore で行う。
 */
import {
    type PublishingEnvironmentKind,
    type SigningKeyEntry,
    type SigningKeyList,
    signingKeyStatus,
} from '@ubichill/shared';

export interface PublishingEnvironmentRow {
    id: string;
    userId: string;
    kind: string;
    name: string;
    publicKey: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
}

export function signingKeyEntryOf(row: Pick<PublishingEnvironmentRow, 'publicKey' | 'createdAt' | 'revokedAt'>) {
    return {
        publicKey: row.publicKey,
        addedAt: row.createdAt.toISOString(),
        ...(row.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : {}),
    } satisfies SigningKeyEntry;
}

/** ほかのサーバー向けの鍵一覧（取り消した鍵も revokedAt 付きで残す）。 */
export function signingKeyListOf(
    account: string,
    rows: readonly PublishingEnvironmentRow[],
    now: Date,
): SigningKeyList {
    return { account, issuedAt: now.toISOString(), keys: rows.map(signingKeyEntryOf) };
}

/** 本人向けの一覧の 1 件。 */
export function publishingEnvironmentView(row: PublishingEnvironmentRow) {
    return {
        id: row.id,
        kind: row.kind as PublishingEnvironmentKind,
        name: row.name,
        publicKey: row.publicKey,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
    };
}
export type PublishingEnvironmentView = ReturnType<typeof publishingEnvironmentView>;

/**
 * 公開鍵の登録を受け付けてよいか。
 * - 本人の有効な鍵なら登録済みとして扱う（同じブラウザからの再登録）。
 * - 取り消した鍵は二度と有効にしない（漏えいした鍵の復活を防ぐ）。他人の鍵は受け付けない。
 */
export function registrationOutcome(
    existing: Pick<PublishingEnvironmentRow, 'userId' | 'revokedAt'> | undefined,
    userId: string,
): 'new' | 'already-registered' | 'revoked' | 'taken' {
    if (!existing) return 'new';
    if (existing.userId !== userId) return 'taken';
    return existing.revokedAt ? 'revoked' : 'already-registered';
}

/**
 * レビュー済みの記録（trusted-authors.json）に公式アカウントの公開環境を合わせる。
 * 記録の有効な鍵で未登録のものを追加し、記録で取り消された鍵を取り消す。記録に無い鍵（画面から追加したもの）は触らない。
 * 取り消し済みの鍵は記録が有効でも追加し直さない。
 */
export function officialKeyChanges(
    pinned: readonly SigningKeyEntry[],
    rows: readonly Pick<PublishingEnvironmentRow, 'id' | 'publicKey' | 'revokedAt'>[],
): { add: string[]; revoke: string[] } {
    const add = [...new Set(pinned.map((k) => k.publicKey))].filter(
        (pk) => signingKeyStatus(pinned, pk) === 'active' && !rows.some((r) => r.publicKey === pk),
    );
    const revoke = rows
        .filter((r) => !r.revokedAt && signingKeyStatus(pinned, r.publicKey) === 'revoked')
        .map((r) => r.id);
    return { add, revoke };
}

/** User-Agent から「Chrome on Mac」のような公開環境の既定名を作る（利用者が見分けるためだけ）。 */
export function browserEnvironmentName(userAgent: string | undefined): string {
    const ua = userAgent ?? '';
    const browser =
        [
            ['Edg/', 'Edge'],
            ['Firefox/', 'Firefox'],
            ['Chrome/', 'Chrome'],
            ['Safari/', 'Safari'],
        ].find(([token]) => ua.includes(token))?.[1] ?? 'ブラウザ';
    const os =
        [
            ['iPhone', 'iPhone'],
            ['iPad', 'iPad'],
            ['Android', 'Android'],
            ['Mac OS X', 'Mac'],
            ['Windows', 'Windows'],
            ['Linux', 'Linux'],
        ].find(([token]) => ua.includes(token))?.[1] ?? '';
    return os ? `${browser} on ${os}` : browser;
}
