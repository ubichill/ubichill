/**
 * ブロックする・解除する。できるかの規則は shared の user/blocks.ts。DB と、2 人の関係を消す処理は注入する。
 * ブロックの有無を引くだけなら blockCheck.ts。
 *
 * ブロックの行を先に書いてから関係を消す。関係を消す途中で失敗しても行は残り、相手からの新しい申請は止まる。
 * ブロックし直すと関係を消し直すので、途中で失敗したら同じ操作をやり直せばよい。
 */
import { type BlockEdge, type BlockRefusal, blockRefusal, hasBlocked } from '@ubichill/shared';

export interface BlockServiceDeps {
    store: {
        add(blockerId: string, blockedId: string, now: Date): Promise<boolean>;
        remove(blockerId: string, blockedId: string): Promise<boolean>;
        countForUser(blockerId: string): Promise<number>;
        findBetween(a: string, b: string): Promise<BlockEdge[]>;
    };
    /** 2 人の関係を消す（フレンド・申請・招待・リクエスト・通知、ほかのサーバーの人ならフォロワーも） */
    sever(blockerId: string, blockedId: string): Promise<void>;
    now(): Date;
}

export type BlockOutcome = { ok: true; created: boolean } | { ok: false; reason: BlockRefusal };

export function createBlockService(deps: BlockServiceDeps) {
    return {
        async block(blockerId: string, targetId: string): Promise<BlockOutcome> {
            const [count, edges] = await Promise.all([
                deps.store.countForUser(blockerId),
                deps.store.findBetween(blockerId, targetId),
            ]);
            const refusal = blockRefusal({
                blockerId,
                targetId,
                currentCount: count,
                alreadyBlocked: hasBlocked(edges, blockerId, targetId),
            });
            if (refusal) return { ok: false, reason: refusal };
            const created = await deps.store.add(blockerId, targetId, deps.now());
            await deps.sever(blockerId, targetId);
            return { ok: true, created };
        },

        /** 解除する。消した関係は戻さない（フレンドならもう一度申請する）。 */
        unblock: (blockerId: string, targetId: string): Promise<boolean> => deps.store.remove(blockerId, targetId),
    };
}

export type BlockService = ReturnType<typeof createBlockService>;
