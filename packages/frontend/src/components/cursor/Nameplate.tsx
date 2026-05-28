/**
 * カーソルに追従するネームプレート。
 *
 * - viewport 座標 (x, y) を受け取り、`position: fixed` で固定描画
 * - clicks/hovers をブロックしない (pointerEvents: none)
 * - アバター URL があれば <img>、なければデフォルト SVG を表示
 * - 名前バッジは小さく、視認性のため半透明背景 + 影
 *
 * 純粋なプレゼンテーション。データソース (local mouse / socket presence) は呼び出し側が担う。
 */

import { DefaultAvatar } from './DefaultAvatar';

interface NameplateProps {
    x: number;
    y: number;
    name: string;
    /** アバター画像 URL。未指定時はデフォルト SVG。 */
    avatarUrl?: string | null;
    /** デフォルトアバターのアクセント色 (penColor 等から借りる)。 */
    accentColor?: string | null;
    /** 自分自身かどうか。スタイルを少しだけ変える (ボーダー強調)。 */
    isSelf?: boolean;
    /** 一番上に出すので大きめ。リモートは少し控えめに。 */
    zIndex?: number;
}

const AVATAR_SIZE = 28;

export function Nameplate({ x, y, name, avatarUrl, accentColor, isSelf, zIndex = 9998 }: NameplateProps) {
    return (
        <div
            style={{
                position: 'fixed',
                left: x,
                top: y,
                transform: 'translate(8px, 8px)', // カーソル先端の右下にオフセット
                pointerEvents: 'none',
                zIndex,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                userSelect: 'none',
            }}
            aria-hidden="true"
        >
            {/* アバター本体 */}
            <div
                style={{
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    background: '#fff',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                    border: isSelf ? '2px solid #5b8def' : '2px solid rgba(255,255,255,0.9)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        draggable={false}
                    />
                ) : (
                    <DefaultAvatar size={AVATAR_SIZE - 4} color={accentColor ?? '#5b8def'} />
                )}
            </div>

            {/* 名前バッジ */}
            <span
                style={{
                    padding: '2px 8px',
                    background: 'rgba(0,0,0,0.72)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 10,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    letterSpacing: '0.01em',
                }}
            >
                {name}
            </span>
        </div>
    );
}
