/**
 * RemoteCursorsPortal — リモートユーザーの cursor + ネームプレートを
 * 「ワールドコンテナの中」に portal する。
 *
 * 設計のキーアイデア:
 *  - リモート位置は **world 座標** で届く。`[data-scroll-world]` の中に
 *    `position: absolute` で world.x/y にそのまま置けば、native scroll で
 *    コンテンツと同じフレームで動く (React も scroll listener も介さない)
 *  - transform に `transition: transform 80ms linear` を付けると、
 *    50ms throttle の broadcast 間隔をブラウザ側で補間して滑らかになる
 *  - 自分の cursor は CSS `cursor: url(...)` 経由なのでこの portal には含めない
 */

import type { User } from '@ubichill/shared';
import { createPortal } from 'react-dom';
import { Nameplate } from './Nameplate';

interface RemoteCursorsPortalProps {
    scrollEl: HTMLElement;
    users: Map<string, User>;
    selfId: string | undefined;
}

// 50ms throttle の broadcast 間にちょうど 1〜2 フレームかかるくらいの補間時間
const TRANSITION_MS = 80;
const CURSOR_SIZE = 24;

const ARROW_PATH = 'M3 3 L3 19 L7.5 14.5 L10.5 21 L13 19.8 L10 13.5 L17 13 Z';

export function RemoteCursorsPortal({ scrollEl, users, selfId }: RemoteCursorsPortalProps) {
    return createPortal(
        Array.from(users.values()).map((u) => {
            if (u.id === selfId) return null;
            return (
                <div
                    key={u.id}
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        transform: `translate3d(${u.position.x}px, ${u.position.y}px, 0)`,
                        transition: `transform ${TRANSITION_MS}ms linear`,
                        pointerEvents: 'none',
                        zIndex: 9998,
                        willChange: 'transform',
                    }}
                >
                    {/* カーソル本体: cursorUrl があれば img、無ければ default 矢印 SVG */}
                    {u.cursorUrl ? (
                        <img
                            src={u.cursorUrl}
                            alt=""
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                width: CURSOR_SIZE,
                                height: CURSOR_SIZE,
                                display: 'block',
                                pointerEvents: 'none',
                            }}
                            draggable={false}
                        />
                    ) : (
                        <svg
                            width={CURSOR_SIZE}
                            height={CURSOR_SIZE}
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                display: 'block',
                                pointerEvents: 'none',
                            }}
                        >
                            <path
                                d={ARROW_PATH}
                                fill="white"
                                stroke="rgba(0,0,0,0.85)"
                                strokeWidth="1.4"
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        </svg>
                    )}
                    <Nameplate name={u.name} avatarUrl={u.avatarUrl} accentColor={u.penColor ?? null} />
                </div>
            );
        }),
        scrollEl,
    );
}
