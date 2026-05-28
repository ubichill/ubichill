/**
 * CursorLayer — アプリ全体に「自分のカーソル本体 + ネームプレート」を被せる top-level overlay。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 自分 (SelfCursor):                                                    │
 * │   - viewport 座標 (pointermove の clientX/Y) で position: fixed       │
 * │   - scroll math 不要 → どのページでも追従                              │
 * │                                                                       │
 * │ 他人 (RemoteCursorsPortal):                                           │
 * │   - インスタンス内のときだけ                                            │
 * │   - `[data-scroll-world]` の中に portal で world 座標で配置             │
 * │   - native scroll に native のフレームレートで追従 (React 経由しない)   │
 * │   - 50ms broadcast を 80ms CSS transition で補間して滑らかに見せる     │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * - OS カーソルは常時非表示 (CursorIcon が cursorUrl または DefaultCursorIcon を必ず描画)
 * - 自分のカーソル位置はインスタンス参加中だけ socket 経由で 50ms throttle 配信
 *   (旧 avatar:cursor プラグインがやっていた役割を本体に移管)
 */

import { useSocket } from '@ubichill/sdk/react';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { CursorBundle } from './CursorBundle';
import { RemoteCursorsPortal } from './RemoteCursorsPortal';
import { useBroadcastCursor } from './useBroadcastCursor';
import { useLocalCursor } from './useLocalCursor';
import { useScrollWorldEl } from './useScrollWorldEl';

export function CursorLayer() {
    const localCursor = useLocalCursor();
    const session = useSession();
    const { users, currentUser, isConnected } = useSocket();
    const scrollEl = useScrollWorldEl();

    const selfName = currentUser?.name || session.data?.user?.name || 'あなた';
    const selfAvatarUrl = currentUser?.avatarUrl ?? null;
    const selfCursorUrl = currentUser?.cursorUrl ?? null;
    const selfAccent = currentUser?.penColor ?? null;
    const selfId = currentUser?.id ?? session.data?.user?.id;

    // OS カーソル常時非表示: CursorIcon が必ず何かを描画する (custom or default)
    useEffect(() => {
        const prev = document.body.style.cursor;
        document.body.style.cursor = 'none';
        return () => {
            document.body.style.cursor = prev;
        };
    }, []);

    // 自分のカーソル位置を他人へブロードキャスト (インスタンス参加中のみ実効)。
    // 内部で `viewport + scroll = world` 変換を行う。
    useBroadcastCursor(localCursor, scrollEl);

    return (
        <>
            {/* 自分のカーソル (viewport 固定, どのページでも) */}
            {localCursor && (
                <div
                    style={{
                        position: 'fixed',
                        left: 0,
                        top: 0,
                        transform: `translate3d(${localCursor.x}px, ${localCursor.y}px, 0)`,
                        pointerEvents: 'none',
                        zIndex: 10001,
                        willChange: 'transform',
                    }}
                >
                    <CursorBundle
                        cursorUrl={selfCursorUrl}
                        name={selfName}
                        avatarUrl={selfAvatarUrl}
                        accentColor={selfAccent}
                        isSelf
                    />
                </div>
            )}

            {/* リモートユーザー: scroll container 内に portal (instance 内のみ) */}
            {isConnected && scrollEl && <RemoteCursorsPortal scrollEl={scrollEl} users={users} selfId={selfId} />}
        </>
    );
}
