import type { RevokeReason, WorldIdentity } from '@ubichill/shared';

export interface ResignCandidate {
    id: string;
    displayName: string;
    updatedAt?: string;
    identity?: WorldIdentity;
}

/** 取り消した公開環境（署名し直しの判断に使う分だけ）。 */
export interface RevokedEnvironment {
    publicKey: string;
    name: string;
    revokedAt: string;
    revokeReason: RevokeReason | null;
}

export interface ResignTarget<W extends ResignCandidate> {
    world: W;
    /** そのワールドに署名した（取り消した）公開環境。 */
    signedBy: RevokedEnvironment;
}

/**
 * 取り消した公開環境の鍵で署名されていて、署名し直せば一覧に戻るワールドを、取り消しの理由で分ける。
 * - bulk: 紛失で取り消した鍵の署名。内容は本人が書いたものなので、まとめて署名し直してよい
 * - review: 漏えい・心当たりのない環境として取り消した鍵の署名。攻撃者が書き換えた内容かもしれないので、
 *   1 つずつ内容を確かめてから署名し直させる（まとめて署名し直すと、攻撃者の内容に本人の鍵で署名してしまう）
 *   理由が記録されていない取り消しも、安全側に倒して review に入れる
 * 署名したことのないワールド（未署名）は、本人が非公開のつもりの可能性があるので含めない。
 */
export function worldsNeedingResign<W extends ResignCandidate>(
    worlds: readonly W[],
    revoked: readonly RevokedEnvironment[],
): { bulk: ResignTarget<W>[]; review: ResignTarget<W>[] } {
    const byKey = new Map(revoked.map((e) => [e.publicKey, e]));
    const targets = worlds.flatMap((world) => {
        const identity = world.identity;
        if (identity?.status !== 'verified' || identity.author) return [];
        const signedBy = byKey.get(identity.publicKey);
        return signedBy ? [{ world, signedBy }] : [];
    });
    return {
        bulk: targets.filter((t) => t.signedBy.revokeReason === 'lost'),
        review: targets.filter((t) => t.signedBy.revokeReason !== 'lost'),
    };
}

export interface ResignResult<I> {
    done: Array<{ id: string; identity: I }>;
    failed: Array<{ id: string; error: string }>;
}

/** 順に署名し直す。1 つ失敗しても残りは続け、失敗したものと理由をまとめて返す。 */
export async function resignAll<I>(
    ids: readonly string[],
    signOne: (id: string) => Promise<I>,
): Promise<ResignResult<I>> {
    return ids.reduce<Promise<ResignResult<I>>>(
        async (prev, id) => {
            const acc = await prev;
            try {
                return { ...acc, done: [...acc.done, { id, identity: await signOne(id) }] };
            } catch (e) {
                return { ...acc, failed: [...acc.failed, { id, error: e instanceof Error ? e.message : String(e) }] };
            }
        },
        Promise.resolve({ done: [], failed: [] }),
    );
}
