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
 */

import { useSocket } from '@ubichill/sdk/react';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { applyCursorStyles, removeCursorStyles } from './cursorImages';
import { RemoteCursorsPortal } from './RemoteCursorsPortal';
import { useBroadcastCursor } from './useBroadcastCursor';
import { useScrollWorldEl } from './useScrollWorldEl';

export function CursorLayer() {
    const session = useSession();
    const { users, currentUser, isConnected } = useSocket();
    const scrollEl = useScrollWorldEl();

    const selfCursorUrl = currentUser?.cursorUrl ?? null;
    const selfId = currentUser?.id ?? session.data?.user?.id;

    // CSS cursor を注入 (user.cursorUrl が変わったら更新)
    useEffect(() => {
        applyCursorStyles(selfCursorUrl);
        return removeCursorStyles;
    }, [selfCursorUrl]);

    // 自分のカーソル位置を他人へブロードキャスト (インスタンス参加中のみ実効)
    useBroadcastCursor(scrollEl);

    // 自分の cursor は CSS 側で描画されているので JSX には何も無い (ラグ無し)。
    // リモートユーザーぶんだけ JS で overlay する。
    return isConnected && scrollEl ? <RemoteCursorsPortal scrollEl={scrollEl} users={users} selfId={selfId} /> : null;
}
