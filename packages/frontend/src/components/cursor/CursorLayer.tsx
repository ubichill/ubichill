/**
 * CursorLayer — アプリ全体に「自分のカーソル本体 + ネームプレート」を被せる top-level overlay。
 *
 * 視覚要素の分離 (UI と意味):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ CursorIcon (user.cursorUrl)  ← マウス先端そのもの         │
 *   │ Nameplate (user.avatarUrl + user.name) ← オフセット表示    │
 *   └─────────────────────────────────────────────────────────┘
 *
 * - ロビー / エディター / インスタンス、どこでも自分のネームプレートが付いてくる。
 * - インスタンス内のときだけ追加で他ユーザー (socket presence) を描画する。
 * - `cursorUrl` が設定されているユーザーは OS デフォルトカーソルを CSS で隠す
 *   (二重カーソル防止)。これは自分にだけ適用する (他人の OS カーソルは隠せないので)。
 *
 * 旧 avatar:cursor プラグインの責務を本体に取り込んだもの。プラグインの有無に依らず
 * 常に名前 + 仮アバター + 仮カーソルが見える。アバター / カーソル画像の選択 UI は別 PR。
 */

import { useSocket } from '@ubichill/sdk/react';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { CursorIcon } from './CursorIcon';
import { Nameplate } from './Nameplate';
import { useLocalCursor } from './useLocalCursor';
import { useWorldScroll } from './useWorldScroll';

export function CursorLayer() {
    const localCursor = useLocalCursor();
    const session = useSession();
    const { users, currentUser, isConnected } = useSocket();
    const scroll = useWorldScroll();

    // 自分の表示情報: socket の currentUser → セッション → fallback
    const selfName = currentUser?.name || session.data?.user?.name || 'あなた';
    const selfAvatarUrl = currentUser?.avatarUrl ?? null;
    const selfCursorUrl = currentUser?.cursorUrl ?? null;
    const selfAccent = currentUser?.penColor ?? null;
    const selfId = currentUser?.id ?? session.data?.user?.id;

    // cursorUrl 設定時は OS カーソルを消す (自分のみ)
    useEffect(() => {
        if (!selfCursorUrl) return;
        const prev = document.body.style.cursor;
        document.body.style.cursor = 'none';
        return () => {
            document.body.style.cursor = prev;
        };
    }, [selfCursorUrl]);

    return (
        <>
            {/* 自分のカーソル + ネームプレート (どのページでも) */}
            {localCursor && (
                <>
                    <CursorIcon x={localCursor.x} y={localCursor.y} cursorUrl={selfCursorUrl} zIndex={10001} />
                    <Nameplate
                        x={localCursor.x}
                        y={localCursor.y}
                        name={selfName}
                        avatarUrl={selfAvatarUrl}
                        accentColor={selfAccent}
                        isSelf
                        zIndex={9999}
                    />
                </>
            )}

            {/* 他ユーザー (インスタンス内のみ presence が populate される) */}
            {isConnected &&
                Array.from(users.values()).map((u) => {
                    if (u.id === selfId) return null;
                    // world → viewport 変換 (data-scroll-world からの相対位置)
                    const viewportX = u.position.x - scroll.x;
                    const viewportY = u.position.y - scroll.y;
                    return (
                        <span key={u.id}>
                            <CursorIcon x={viewportX} y={viewportY} cursorUrl={u.cursorUrl ?? null} zIndex={9998} />
                            <Nameplate
                                x={viewportX}
                                y={viewportY}
                                name={u.name}
                                avatarUrl={u.avatarUrl}
                                accentColor={u.penColor ?? null}
                                zIndex={9997}
                            />
                        </span>
                    );
                })}
        </>
    );
}
