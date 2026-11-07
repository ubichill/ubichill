/**
 * 公開環境（作者アカウントの署名鍵）の純粋なロジック。DB の読み書きは routes / officialAccountStore で行う。
 */
import type { PublishingEnvironmentKind, RevokeReason, SigningKeyEntry, SigningKeyList } from '@ubichill/shared';

export interface PublishingEnvironmentRow {
    id: string;
    userId: string;
    kind: string;
    name: string;
    publicKey: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    revokeReason?: string | null;
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
        revokeReason: (row.revokeReason as RevokeReason | null | undefined) ?? null,
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

/** 新しい公開環境が追加されたことの通知（心当たりがなければ取り消してパスワードを変える）。 */
export function newEnvironmentNotice(args: {
    displayName: string;
    environmentName: string;
    siteUrl: string;
    at: Date;
}) {
    return {
        subject: '新しい公開環境が追加されました',
        text: `${args.displayName} さん

あなたのアカウントに、ワールドを公開できる環境「${args.environmentName}」が追加されました（${args.at.toISOString()}）。

心当たりがない場合は、すぐに次を行ってください。
1. ${args.siteUrl} を開き、設定の「公開」（公開できるブラウザ・CLI・CI）で、その環境を「漏えい・心当たりのない環境」として取り消す
2. パスワードを変更し、ほかの端末をすべてログアウトする

心当たりがある場合は、このメールは無視してかまいません。`,
    };
}
