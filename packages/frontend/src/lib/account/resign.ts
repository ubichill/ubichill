import type { WorldIdentity } from '@ubichill/shared';

export interface ResignCandidate {
    id: string;
    displayName: string;
    identity?: WorldIdentity;
}

/**
 * 取り消した公開環境の鍵で署名されていて、署名し直せば一覧に戻るワールド。
 * 署名したことのないワールド（未署名）は、本人が非公開のつもりの可能性があるので含めない。
 */
export function worldsNeedingResign<W extends ResignCandidate>(
    worlds: readonly W[],
    revokedKeys: ReadonlySet<string>,
): W[] {
    return worlds.filter(
        (w) => w.identity?.status === 'verified' && !w.identity.author && revokedKeys.has(w.identity.publicKey),
    );
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
