/**
 * 公開環境（作者アカウントの署名鍵）の規則と手順。DB・メール・キャッシュは注入する（実体は publishingEnvironmentService.ts）。
 * 鍵を足す・取り消すのはここだけ（作者の表示のキャッシュを捨てるのを忘れないように。CI の author-key-writes-in-one-place）。
 */
import {
    type PublishingEnvironmentKind,
    publishingEnvironmentKindLabel,
    publishingEnvironmentSettingsPath,
    type RevokeReason,
    type SigningKeyEntry,
    type SigningKeyList,
    signingKeyFingerprint,
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

/**
 * メールの 1 行に入れる名前（CLI・CI の名前は承認した人以外が決める）。改行（行・段落の区切り U+2028・U+2029 も）・
 * 書字方向の制御で文面を偽らせない。
 */
const oneLine = (text: string): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim();

/**
 * 新しい公開環境が追加されたことの通知（心当たりがなければ取り消してパスワードを変える）。
 * 鍵の指紋は一覧・CLI の承認画面と同じもので、どの環境かを見比べられるようにする。取り消しはリンク先の画面で
 * （ログインして）行う。メールのリンクだけで取り消せるようにはしない（メールの転送・漏えいで取り消させない）。
 */
export function newEnvironmentNotice(args: {
    displayName: string;
    environment: Pick<PublishingEnvironmentRow, 'id' | 'kind' | 'name' | 'publicKey' | 'createdAt'>;
    siteUrl: string;
}) {
    const { environment } = args;
    const link = new URL(publishingEnvironmentSettingsPath(environment.id), args.siteUrl).href;
    return {
        subject: '新しい公開環境が追加されました',
        text: `${oneLine(args.displayName)} さん

あなたのアカウントに、ワールドを公開できる環境が追加されました。

種類: ${publishingEnvironmentKindLabel(environment.kind)}
名前: 『${oneLine(environment.name)}』（追加した側が付けた名前）
鍵の指紋: ${signingKeyFingerprint(environment.publicKey)}
追加日時: ${environment.createdAt.toISOString()}

心当たりがない場合は、すぐに次を行ってください。
1. 次のリンクを開き、この環境を「漏えい・心当たりがない」として取り消す
${link}
2. パスワードを変更し、ほかの端末をすべてログアウトする

リンク先の一覧にも同じ鍵の指紋が出ます。心当たりがある場合は、このメールは無視してかまいません。`,
    };
}

export type AuthorClaim = { ok: true; environmentId: string } | { ok: false; error: string };

/**
 * 署名の作者を受け付けてよいか。署名には作者アカウントが要り、それはアップロードした本人のアカウントで、鍵はその有効な
 * 公開環境でなければならない（作者の付かない署名は保存しても公開されないので、黙って非公開にせず保存の時点で弾く）。
 * API トークンで送る署名は、そのトークンの公開環境の鍵で署名したものに限る（盗まれたトークンで別の鍵の署名を通させない）。
 */
export function authorClaimOf(args: {
    claimed: unknown;
    ownAccount: string | null;
    environment: Pick<PublishingEnvironmentRow, 'id' | 'userId' | 'revokedAt'> | undefined;
    userId: string;
    tokenEnvironmentId?: string;
}): AuthorClaim {
    const { claimed, environment } = args;
    if (claimed === undefined || claimed === null) {
        return { ok: false, error: '署名に作者アカウントがありません（作者の付かない署名では公開されません）' };
    }
    if (args.ownAccount === null || claimed !== args.ownAccount) {
        return { ok: false, error: `署名の作者（${String(claimed)}）があなたのアカウントと一致しません` };
    }
    if (args.tokenEnvironmentId !== undefined && environment?.id !== args.tokenEnvironmentId) {
        return { ok: false, error: 'API トークンで送る署名は、そのトークンの公開環境の鍵で署名してください' };
    }
    if (!environment || environment.userId !== args.userId || environment.revokedAt) {
        return {
            ok: false,
            error: 'この署名の鍵はあなたの有効な公開環境ではありません（取り消し済みか未登録）。画面を読み込み直して公開し直してください',
        };
    }
    return { ok: true, environmentId: environment.id };
}

/** 鍵の持ち主（通知の宛先。確認済みの連絡先が無ければ送らない）。 */
export interface KeyOwner {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
}

/** API トークンで認証した人（リクエストの user にそのまま入れる）。 */
export interface PublisherUser extends KeyOwner {
    handle: string;
    image?: string | null;
}

export interface NewEnvironment {
    kind: string;
    name: string;
    publicKey: string;
    apiTokenHash?: string;
}

export interface PublishingEnvironmentsDeps {
    keys: {
        listByUser(userId: string): Promise<PublishingEnvironmentRow[]>;
        findLocalKey(publicKey: string): Promise<PublishingEnvironmentRow | undefined>;
        findActiveByTokenHash(tokenHash: string): Promise<PublishingEnvironmentRow | undefined>;
        /** 同じ鍵がもうあれば（同時の登録も含む）作らずに undefined */
        createLocal(input: NewEnvironment & { userId: string }): Promise<PublishingEnvironmentRow | undefined>;
        /** 本人のもので未取り消しのときだけ取り消す */
        revoke(userId: string, id: string, reason: RevokeReason): Promise<PublishingEnvironmentRow | undefined>;
        revokeAllForUser(userId: string, reason: RevokeReason): Promise<number>;
        touch(id: string): Promise<void>;
    };
    findUser(id: string): Promise<PublisherUser | undefined>;
    findUserByHandle(handle: string): Promise<{ id: string; handle: string } | undefined>;
    /** このサーバーの作者アカウント `handle@domain` */
    accountOf(handle: string): string;
    /** ブラウザが鍵を持っていることの証明を確かめる */
    verifyRegistration(
        claim: { userId: string; publicKey: string; at: string },
        signature: string,
    ): Promise<{ ok: true } | { ok: false; reason: string }>;
    /** 鍵が増えた・取り消された（署名の作者の表示が変わるので、全 backend の解決済みワールドを捨てる） */
    keysChanged(): void;
    /** 本人へのメール（確認済みの連絡先が無ければ送らない。失敗しても登録は止めない） */
    notify(owner: KeyOwner, subject: string, text: string): void;
    siteUrl(): string;
    now(): Date;
}

export type RegisterEnvironmentOutcome =
    | { ok: true; created: boolean; environment: PublishingEnvironmentView }
    | { ok: false; status: 409 | 422; error: string; code?: 'revoked' | 'taken' };

const taken = { ok: false, status: 409, error: 'この鍵は登録できません', code: 'taken' } as const;

export function createPublishingEnvironments(deps: PublishingEnvironmentsDeps) {
    /** 作る。作れたら作者の表示を決め直させ、乗っ取った攻撃者が足しても本人が気付けるように知らせる。 */
    async function add(owner: KeyOwner, input: NewEnvironment): Promise<PublishingEnvironmentRow | undefined> {
        const created = await deps.keys.createLocal({ ...input, userId: owner.id });
        if (!created) return undefined;
        deps.keysChanged();
        const notice = newEnvironmentNotice({ displayName: owner.name, environment: created, siteUrl: deps.siteUrl() });
        deps.notify(owner, notice.subject, notice.text);
        return created;
    }

    return {
        /** 本人向けの一覧（取り消したものも含む）。 */
        async list(userId: string): Promise<PublishingEnvironmentView[]> {
            return (await deps.keys.listByUser(userId)).map((row) => publishingEnvironmentView(row));
        },

        /** 取り消されていない鍵（このブラウザの鍵が登録済みかを画面が判定する）。 */
        async activePublicKeysOf(userId: string): Promise<string[]> {
            return (await deps.keys.listByUser(userId)).filter((row) => !row.revokedAt).map((row) => row.publicKey);
        },

        /** ほかのサーバー向けの鍵一覧（取り消した鍵も revokedAt 付き）。作者がいなければ undefined。 */
        async signingKeysOf(handle: string): Promise<SigningKeyList | undefined> {
            const user = await deps.findUserByHandle(handle);
            if (!user) return undefined;
            return signingKeyListOf(deps.accountOf(user.handle), await deps.keys.listByUser(user.id), deps.now());
        },

        /** このブラウザを公開環境として登録する（ログインできる = 公開できる）。秘密鍵の所有を署名で証明させる。 */
        async registerBrowser(
            user: KeyOwner,
            proof: { publicKey: string; at: string; signature: string },
            userAgent: string | undefined,
        ): Promise<RegisterEnvironmentOutcome> {
            const verdict = await deps.verifyRegistration(
                { userId: user.id, publicKey: proof.publicKey, at: proof.at },
                proof.signature,
            );
            if (!verdict.ok) return { ok: false, status: 422, error: `鍵の所有を確認できません (${verdict.reason})` };
            const existing = await deps.keys.findLocalKey(proof.publicKey);
            const outcome = registrationOutcome(existing, user.id);
            if (outcome === 'already-registered' && existing) {
                return { ok: true, created: false, environment: publishingEnvironmentView(existing) };
            }
            if (outcome === 'revoked') {
                return { ok: false, status: 409, error: 'この鍵は取り消し済みのため使えません', code: 'revoked' };
            }
            if (outcome === 'taken') return taken;
            const created = await add(user, {
                kind: 'browser',
                name: browserEnvironmentName(userAgent),
                publicKey: proof.publicKey,
            });
            return created ? { ok: true, created: true, environment: publishingEnvironmentView(created) } : taken;
        },

        /**
         * API トークン付きの公開環境を作る（CLI・CI）。鍵の所有は呼び出し側が確かめておく。
         * トークンは鍵ごとに 1 つなので、登録済みの鍵（本人のものでも）には作らない。作れなければ undefined。
         */
        async registerWithToken(
            owner: KeyOwner,
            input: NewEnvironment & { apiTokenHash: string },
        ): Promise<PublishingEnvironmentView | undefined> {
            if (await deps.keys.findLocalKey(input.publicKey)) return undefined;
            const created = await add(owner, input);
            return created && publishingEnvironmentView(created);
        },

        /** 取り消す。その鍵の署名は、取り消し前のものも含めてすべて作者が付かなくなる。 */
        async revoke(userId: string, id: string, reason: RevokeReason): Promise<PublishingEnvironmentView | undefined> {
            const revoked = await deps.keys.revoke(userId, id, reason);
            if (!revoked) return undefined;
            deps.keysChanged();
            return publishingEnvironmentView(revoked);
        },

        /** 本人の公開環境をすべて取り消す。取り消した数を返す。 */
        async revokeAll(userId: string, reason: RevokeReason): Promise<number> {
            const count = await deps.keys.revokeAllForUser(userId, reason);
            if (count > 0) deps.keysChanged();
            return count;
        },

        /** API トークン（の hash）の公開環境と持ち主。取り消された・持ち主が消えたものは undefined。最終利用を記録する。 */
        async authenticateToken(
            tokenHash: string,
        ): Promise<{ user: PublisherUser; environment: { id: string; publicKey: string; kind: string } } | undefined> {
            const environment = await deps.keys.findActiveByTokenHash(tokenHash);
            const user = environment ? await deps.findUser(environment.userId) : undefined;
            if (!environment || !user) return undefined;
            void deps.keys.touch(environment.id).catch(() => undefined);
            return {
                user,
                environment: { id: environment.id, publicKey: environment.publicKey, kind: environment.kind },
            };
        },

        /** 署名の作者を確かめる（{@link authorClaimOf}）。`tokenEnvironmentId` は API トークンで送ったときの公開環境。 */
        async checkAuthorClaim(
            rawSignature: unknown,
            userId: string,
            tokenEnvironmentId?: string,
        ): Promise<AuthorClaim> {
            const { author: claimed, publicKey } = (rawSignature ?? {}) as { author?: unknown; publicKey?: unknown };
            // 作者の無い署名は DB を引かずに弾く
            if (claimed === undefined || claimed === null) {
                return authorClaimOf({ claimed, ownAccount: null, environment: undefined, userId });
            }
            const [user, environment] = await Promise.all([
                deps.findUser(userId),
                typeof publicKey === 'string' ? deps.keys.findLocalKey(publicKey) : undefined,
            ]);
            return authorClaimOf({
                claimed,
                ownAccount: user ? deps.accountOf(user.handle) : null,
                environment,
                userId,
                tokenEnvironmentId,
            });
        },

        /** 公開に使った公開環境の最終利用を記録する（使われなくなった環境を見分けるため）。失敗しても公開は止めない。 */
        markUsed: (environmentId: string): Promise<void> => deps.keys.touch(environmentId).catch(() => undefined),
    };
}

export type PublishingEnvironments = ReturnType<typeof createPublishingEnvironments>;
