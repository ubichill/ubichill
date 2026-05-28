/**
 * CursorLayer — アプリ全体に「自分のカーソル + ネームプレート」を被せる top-level overlay。
 *
 * - **ロビー / ワールド一覧 / エディター / インスタンス、どこでも自分のネームプレートが付いてくる**。
 * - インスタンス内のときだけ追加で他ユーザーの ネームプレート も描画する
 *   (socket presence の users Map を購読)。
 * - 旧 avatar:cursor プラグインの責務を本体側に取り込んだもの。プラグインに依らず
 *   常に名前と仮アバターが見える状態を提供する。
 *
 * 注: avatar 画像の選択 UI は別途実装予定。MVP は DefaultAvatar (SVG 人型) を仮表示。
 */

import { useSocket } from '@ubichill/sdk/react';
import { useSession } from '@/lib/auth-client';
import { Nameplate } from './Nameplate';
import { useLocalCursor } from './useLocalCursor';
import { useWorldScroll } from './useWorldScroll';

export function CursorLayer() {
    const localCursor = useLocalCursor();
    const session = useSession();
    const { users, currentUser, isConnected } = useSocket();
    const scroll = useWorldScroll();

    // ── 自分の名前は: socket の currentUser → セッションの user → fallback ──
    const selfName = currentUser?.name || session.data?.user?.name || 'あなた';
    const selfAvatarUrl = currentUser?.avatarUrl ?? null;
    const selfAccent = currentUser?.penColor ?? null;
    const selfId = currentUser?.id ?? session.data?.user?.id;

    return (
        <>
            {/* 自分のカーソル (どのページでも) */}
            {localCursor && (
                <Nameplate
                    x={localCursor.x}
                    y={localCursor.y}
                    name={selfName}
                    avatarUrl={selfAvatarUrl}
                    accentColor={selfAccent}
                    isSelf
                    zIndex={9999}
                />
            )}

            {/* 他ユーザー (インスタンス内のみ presence が populate される) */}
            {isConnected &&
                Array.from(users.values()).map((u) => {
                    if (u.id === selfId) return null;
                    // world → viewport 変換 (data-scroll-world からの相対位置)
                    const viewportX = u.position.x - scroll.x;
                    const viewportY = u.position.y - scroll.y;
                    return (
                        <Nameplate
                            key={u.id}
                            x={viewportX}
                            y={viewportY}
                            name={u.name}
                            avatarUrl={u.avatarUrl}
                            accentColor={u.penColor ?? null}
                            zIndex={9997}
                        />
                    );
                })}
        </>
    );
}
