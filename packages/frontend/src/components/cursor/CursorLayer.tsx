/**
 * CursorLayer — アプリ全体に「自分のカーソル + (リモートユーザーのカーソル+ネームプレート)」を被せる top-level overlay。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 自分 (SelfCursor):                                                    │
 * │   - viewport 座標 (pointermove の clientX/Y) で position: fixed       │
 * │   - ネームプレート無し (自分の名前は知ってるし、UI ノイズで「自分の手」  │
 * │     感が薄れる)                                                       │
 * │   - クリック中は scale(0.9) で press フィードバック → 触ったら反応する  │
 * │     物理感で「自分の延長」と脳が認識しやすい                            │
 * │                                                                       │
 * │ 他人 (RemoteCursorsPortal):                                           │
 * │   - インスタンス内のときだけ                                            │
 * │   - `[data-scroll-world]` の中に portal で world 座標で配置             │
 * │   - native scroll に native のフレームレートで追従 (React 経由しない)   │
 * │   - 50ms broadcast を 80ms CSS transition で補間して滑らかに見せる     │
 * │   - ネームプレート (アバター + 名前 が一体のピル) を cursor の真上に配置 │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * - OS カーソルは常時非表示 (CursorIcon が cursorUrl または DefaultCursorIcon を必ず描画)
 * - 自分のカーソル位置は pointermove + scroll の両方をトリガに socket 配信
 *   (旧 avatar:cursor プラグインの役割)
 */

import { useSocket } from '@ubichill/sdk/react';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { CursorBundle } from './CursorBundle';
import { RemoteCursorsPortal } from './RemoteCursorsPortal';
import { useBroadcastCursor } from './useBroadcastCursor';
import { useLocalCursor } from './useLocalCursor';
import { usePressFeedback } from './usePressFeedback';
import { useScrollWorldEl } from './useScrollWorldEl';

export function CursorLayer() {
    const localCursor = useLocalCursor();
    const session = useSession();
    const { users, currentUser, isConnected } = useSocket();
    const scrollEl = useScrollWorldEl();
    const pressed = usePressFeedback();

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

    // 自分のカーソル位置を他人へブロードキャスト (インスタンス参加中のみ実効)
    useBroadcastCursor(localCursor, scrollEl);

    return (
        <>
            {/* 自分のカーソル: viewport 固定 + 押下フィードバック、nameplate 無し */}
            {localCursor && (
                <div
                    style={{
                        position: 'fixed',
                        left: 0,
                        top: 0,
                        // pressed=true なら少し縮める。transform-origin は cursor 先端 (0,0)
                        transform: `translate3d(${localCursor.x}px, ${localCursor.y}px, 0) scale(${pressed ? 0.85 : 1})`,
                        transformOrigin: '0 0',
                        transition: 'transform 80ms cubic-bezier(0.2, 0.7, 0.2, 1)',
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
                        showNameplate={false}
                    />
                </div>
            )}

            {/* リモートユーザー: scroll container 内に portal (instance 内のみ) */}
            {isConnected && scrollEl && <RemoteCursorsPortal scrollEl={scrollEl} users={users} selfId={selfId} />}
        </>
    );
}
