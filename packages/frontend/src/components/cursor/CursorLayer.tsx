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
 * (旧 avatar:cursor modの役割)。
 *
 * 持っているエンティティの追従同期:
 *  - useBroadcastCursor が cursor:move 送信時に heldEntitySyncRef から heldEntityId を含める
 *  - cursor:moved を受信したら HeldEntityPositionRegistry.notify で EntityRenderer に伝達
 *  ※ CursorLayer は HoldProvider の外側（router レベル）で動くため、
 *    useHold() ではなくモジュールレベルの heldEntitySyncRef / HeldEntityPositionRegistry を使う
 */

import { useSocket, useWorld } from '@ubichill/react';
import { useEffect, useRef } from 'react';
import { HeldEntityPositionRegistry } from '@/instance/HeldEntityPositionRegistry';
import { readHeldOffset } from '@/instance/heldOffset';
import { useSession } from '@/lib/session';
import { applyCursorStyles, removeCursorStyles } from './cursorImages';
import { RemoteCursorsPortal } from './RemoteCursorsPortal';
import { useBroadcastCursor } from './useBroadcastCursor';
import { useScrollWorldEl } from './useScrollWorldEl';

export function CursorLayer() {
    const session = useSession();
    const { users, currentUser, isConnected, socket } = useSocket();
    const { entities } = useWorld();
    const scrollEl = useScrollWorldEl();

    const selfCursorUrl = currentUser?.cursorUrl ?? null;
    const selfId = currentUser?.id ?? session.data?.user?.id;

    // socket イベントハンドラ内から「常に最新の entities」を読むための ref。
    // socket.on を毎フレ再 subscribe するコストを避ける。
    const entitiesRef = useRef(entities);
    useEffect(() => {
        entitiesRef.current = entities;
    });

    // CSS cursor を注入 (user.cursorUrl が変わったら更新)
    useEffect(() => {
        applyCursorStyles(selfCursorUrl);
        return removeCursorStyles;
    }, [selfCursorUrl]);

    // 自分のカーソル位置を他人へブロードキャスト (インスタンス参加中のみ実効)
    // HeldEntityStateRef 経由で heldEntityId を cursor:move に含める
    useBroadcastCursor(scrollEl);

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
            // entity.data.heldOffset を grip per-entity の offset として読む (共通ヘルパ readHeldOffset)。
            // 未設定なら DEFAULT_HELD_OFFSET ({ x: -24, y: 0 }) にフォールバック。
            // EntityRenderer は world 座標を期待するためそのまま渡す。
            const offset = readHeldOffset(entitiesRef.current.get(heldEntityId));
            HeldEntityPositionRegistry.notify(heldEntityId, position.x + offset.x, position.y + offset.y);
        };
        socket.on('cursor:moved', handler);
        return () => {
            socket.off('cursor:moved', handler);
        };
    }, [socket, selfId]);

    // 自分のカーソル位置: OS コンポジタが描画するため JSX には何もない。
    // リモートユーザー分だけ JS で overlay する。
    return isConnected && scrollEl ? <RemoteCursorsPortal scrollEl={scrollEl} users={users} selfId={selfId} /> : null;
}
