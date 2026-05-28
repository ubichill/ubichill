/**
 * RemoteCursorsPortal — リモートユーザーのカーソルを「ワールドコンテナの中」に portal する。
 *
 * 設計のキーアイデア:
 *  - 旧実装は viewport 固定 + React state で scroll を読んでいたため、scroll に対して
 *    フレーム遅れ ("ちょっと遅れて付いてくる") していた
 *  - リモート位置は **world 座標** で届く。`[data-scroll-world]` の中に
 *    `position: absolute` で world.x/y にそのまま置けば、native scroll で
 *    コンテンツと同じフレームで動く (React も scroll listener も介さない)
 *  - 加えて transform に `transition: transform 80ms linear` を付けると、
 *    50ms throttle の broadcast 間隔をブラウザ側で補間してくれて滑らかになる
 */

import type { User } from '@ubichill/shared';
import { createPortal } from 'react-dom';
import { CursorBundle } from './CursorBundle';

interface RemoteCursorsPortalProps {
    scrollEl: HTMLElement;
    users: Map<string, User>;
    selfId: string | undefined;
}

// 50ms throttle の broadcast 間にちょうど 1〜2 フレームかかるくらいの補間時間。
// 長くしすぎるとリモートカーソルが「ふわっ」と遅れて見える。
const TRANSITION_MS = 80;

export function RemoteCursorsPortal({ scrollEl, users, selfId }: RemoteCursorsPortalProps) {
    return createPortal(
        <>
            {Array.from(users.values()).map((u) => {
                if (u.id === selfId) return null;
                return (
                    <div
                        key={u.id}
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            // translate3d で GPU 合成 + 50ms 単位の update を 80ms で補間
                            transform: `translate3d(${u.position.x}px, ${u.position.y}px, 0)`,
                            transition: `transform ${TRANSITION_MS}ms linear`,
                            pointerEvents: 'none',
                            // インスタンス内のすべての通常コンテンツ + プラグインより前面
                            zIndex: 9998,
                            willChange: 'transform',
                        }}
                    >
                        <CursorBundle
                            cursorUrl={u.cursorUrl ?? null}
                            name={u.name}
                            avatarUrl={u.avatarUrl}
                            accentColor={u.penColor ?? null}
                        />
                    </div>
                );
            })}
        </>,
        scrollEl,
    );
}
