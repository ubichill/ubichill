/**
 * Nameplate — アバター画像 + 名前バッジ。リモートユーザーに対してのみ表示する。
 *
 * 「カーソルの真上」に配置する: 視線が cursor 先端にある状態で、ほぼ視線移動なく
 * 名前が読める (Figma 等の常識的な配置)。CursorBundle の親基準で position: absolute。
 *
 * 自分自身には表示しない (= CursorLayer 側で省略)。自分の名前は自分で知っているし、
 * 「自分の手」感を出すために UI ノイズを減らす方針。
 */

import { DefaultAvatar } from './DefaultAvatar';

interface NameplateProps {
    name: string;
    /** プロフィール画像 URL。未指定時はデフォルト SVG。 */
    avatarUrl?: string | null;
    /** デフォルトアバターのアクセント色 (penColor 等から借りる)。 */
    accentColor?: string | null;
}

const AVATAR_SIZE = 22;

export function Nameplate({ name, avatarUrl, accentColor }: NameplateProps) {
    return (
        <div
            style={{
                position: 'absolute',
                // cursor 先端 (親の 0, 0) より上 + 少し右に出す
                left: 12,
                bottom: 8,
                transform: 'translateY(-100%)', // 高さぶん上に持ち上げる
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 8px 2px 2px',
                background: 'rgba(0,0,0,0.78)',
                color: '#fff',
                borderRadius: 999, // ピル形状
                boxShadow: '0 2px 6px rgba(0,0,0,0.22)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
            }}
        >
            {/* 一体化したアバター: ピルの左端に丸く埋め込み */}
            <span
                style={{
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    background: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        draggable={false}
                    />
                ) : (
                    <DefaultAvatar size={AVATAR_SIZE - 4} color={accentColor ?? '#5b8def'} />
                )}
            </span>
            {name}
        </div>
    );
}
