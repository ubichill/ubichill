/**
 * CursorLayer — アプリ全体に「自分のカーソル本体 + ネームプレート」を被せる top-level overlay。
 *
 * 視覚要素の分離 (UI と意味):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ CursorIcon (user.cursorUrl)  ← マウス先端そのもの         │
 *   │ Nameplate (user.avatarUrl + user.name) ← オフセット表示    │
 *   └─────────────────────────────────────────────────────────┘
 *
 * - ロビー / エディター / インスタンス、どこでも自分のネームプレート + カーソルが付いてくる
 * - インスタンス内のときだけ追加で他ユーザー (socket presence) を描画する
 * - OS カーソルは常時非表示 (CursorIcon が cursorUrl または DefaultCursorIcon を必ず描画する)
 * - 自分のカーソル位置はインスタンス内で他ユーザーに socket 経由でブロードキャストする
 *   (旧 avatar:cursor プラグインがやっていた役割)
 *
 * 旧 avatar:cursor プラグインの責務を本体に取り込んだもの。プラグインの有無に依らず
 * 常に名前 + 仮アバター + 仮カーソルが見える。選択 UI は別 PR。
 */

import { useSocket } from '@ubichill/sdk/react';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { CursorIcon } from './CursorIcon';
import { Nameplate } from './Nameplate';
import { useBroadcastCursor } from './useBroadcastCursor';
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

    // OS カーソルは常時消す: CursorIcon が必ず何かを描画する (DefaultCursorIcon 含む) ので
    // 二重カーソルにならない。テキスト入力等の I-beam も犠牲になるが、コラボアプリでは
    // 自分も他人も同じ視覚モデル (custom cursor) で揃える方が一貫性が高い (Figma 系の判断)。
    useEffect(() => {
        const prev = document.body.style.cursor;
        document.body.style.cursor = 'none';
        return () => {
            document.body.style.cursor = prev;
        };
    }, []);

    // 自分のカーソル位置を他ユーザーへブロードキャスト (インスタンス参加中のみ実効)
    useBroadcastCursor(localCursor, scroll);

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
