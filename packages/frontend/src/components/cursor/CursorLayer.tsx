/**
 * CursorLayer — アプリの cursor 表示を統括する top-level コンポーネント。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 自分 (CSS cursor):                                                    │
 * │   - `body { cursor: url(...) }` を注入。OS コンポジタが描画 → ラグ無し  │
 * │   - button → pointer / input → text I-beam に browser が自動切替       │
 * │   - user.cursorUrl があれば矢印画像をそれで置換 (pointer / text は固定) │
 * │                                                                       │
 * │ 他人 (RemoteCursorsPortal):                                           │
 * │   - インスタンス内のときだけ                                            │
 * │   - `[data-scroll-world]` の中に portal で world 座標で配置             │
 * │   - native scroll に native のフレームレートで追従                      │
 * │   - 50ms broadcast を 80ms CSS transition で補間                       │
 * │   - ネームプレート (アバター + 名前) を cursor の真上に表示             │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 自分のカーソル位置は pointermove + scroll の両方をトリガに socket 配信
 * (旧 avatar:cursor プラグインの役割)。
 *
 * 持っているエンティティの追従同期:
 *  - heldRef を useBroadcastCursor に渡して cursor:move に heldEntityId を含める
 *  - cursor:moved を受信したら HeldEntityPositionRegistry.notify で EntityRenderer に伝達
 */

import { useHold, useSocket } from '@ubichill/sdk/react';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { HeldEntityPositionRegistry } from '@/instance/HeldEntityPositionRegistry';
import { applyCursorStyles, removeCursorStyles } from './cursorImages';
import { RemoteCursorsPortal } from './RemoteCursorsPortal';
import { useBroadcastCursor } from './useBroadcastCursor';
import { useScrollWorldEl } from './useScrollWorldEl';

export function CursorLayer() {
    const session = useSession();
    const { users, currentUser, isConnected, socket } = useSocket();
    const { heldRef } = useHold();
    const scrollEl = useScrollWorldEl();

    const selfCursorUrl = currentUser?.cursorUrl ?? null;
    const selfId = currentUser?.id ?? session.data?.user?.id;

    // CSS cursor を注入 (user.cursorUrl が変わったら更新)
    useEffect(() => {
        applyCursorStyles(selfCursorUrl);
        return removeCursorStyles;
    }, [selfCursorUrl]);

    // 自分のカーソル位置を他人へブロードキャスト (インスタンス参加中のみ実効)
    // heldRef を渡して cursor:move に heldEntityId を含める
    useBroadcastCursor(scrollEl, heldRef);

    // cursor:moved を受信したら HeldEntityPositionRegistry に通知する
    // → EntityRenderer が DOM を直接更新して追従を実現する（React 再レンダーなし）
    useEffect(() => {
        if (!socket) return;
        const handler = ({
            userId,
            position,
            heldEntityId,
        }: {
            userId: string;
            position: { x: number; y: number };
            heldEntityId?: string | null;
        }) => {
            if (!heldEntityId || userId === selfId) return;
            // viewport 座標 = world 座標 - scroll
            const sx = scrollEl?.scrollLeft ?? 0;
            const sy = scrollEl?.scrollTop ?? 0;
            // オフセット: デフォルトで左側に -24px
            HeldEntityPositionRegistry.notify(heldEntityId, position.x - sx - 24, position.y - sy);
        };
        socket.on('cursor:moved', handler);
        return () => {
            socket.off('cursor:moved', handler);
        };
    }, [socket, selfId, scrollEl]);

    // 自分のカーソル位置: OS コンポジタが描画するため JSX には何もない。
    // リモートユーザー分だけ JS で overlay する。
    return isConnected && scrollEl ? (
        <RemoteCursorsPortal scrollEl={scrollEl} users={users} selfId={selfId} />
    ) : null;
}
