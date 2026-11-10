import type { Friendship, RemoteRelation } from '@ubichill/shared';
import { useState } from 'react';
import { relationAfterBlock, type UserRelation, type UserRelationSource, userRelationOf } from './userRelation';

/**
 * ほかの人と自分との関係（フレンド・フォローされているか・ブロックしているか）。取得は呼ぶ側がプロフィールと一緒に済ませ、ここは
 * その値と、画面での操作（申請・解除など）による変更だけを持つ。source が null（自分・未ログイン）なら関係は無い。
 */
export function useUserRelation(source: UserRelationSource | null) {
    const [edited, setEdited] = useState<{ source: UserRelationSource; value: UserRelation } | null>(null);
    const current = source ? (edited?.source === source ? edited.value : userRelationOf(source)) : null;
    const update = (next: (value: UserRelation) => UserRelation) => {
        if (!source) return;
        setEdited((prev) => ({
            source,
            value: next(prev?.source === source ? prev.value : userRelationOf(source)),
        }));
    };
    return {
        friendship: current?.friendship ?? null,
        relation: current?.relation ?? {},
        blocked: current?.blocked ?? false,
        setFriendship: (friendship: Friendship) => update((v) => ({ ...v, friendship })),
        setRelation: (relation: RemoteRelation) => update((v) => ({ ...v, relation })),
        setBlocked: (blocked: boolean) => update((v) => (blocked ? relationAfterBlock(v) : { ...v, blocked: false })),
    };
}
