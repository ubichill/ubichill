import type { Friendship, RemoteRelation } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { fetchUserWithFriendship } from '@/lib/socialApi';

interface Relation {
    userId: string;
    friendship: Friendship;
    relation: RemoteRelation;
}

/** ほかの人と自分との関係（フレンド・フォローされているか）。userId が null（自分・未ログイン）なら読まない。 */
export function useUserRelation(userId: string | null) {
    const [state, setState] = useState<Relation | null>(null);

    useEffect(() => {
        if (!userId) return;
        const ctrl = { cancelled: false };
        fetchUserWithFriendship(userId)
            .then((u) => {
                if (ctrl.cancelled) return;
                setState({
                    userId,
                    friendship: u.friendship,
                    relation: {
                        ...(u.friendsUnsupported ? { friendsUnsupported: true } : {}),
                        ...(u.followsYou ? { followsYou: u.followsYou } : {}),
                    },
                });
            })
            .catch(() => !ctrl.cancelled && setState(null));
        return () => {
            ctrl.cancelled = true;
        };
    }, [userId]);

    const current = state && state.userId === userId ? state : null;
    return {
        friendship: current?.friendship ?? null,
        relation: current?.relation ?? {},
        setFriendship: (friendship: Friendship) => setState((s) => s && { ...s, friendship }),
        setRelation: (relation: RemoteRelation) => setState((s) => s && { ...s, relation }),
    };
}
