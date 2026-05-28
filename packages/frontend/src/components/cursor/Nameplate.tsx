/**
 * Nameplate — アバター画像 + 名前バッジ。
 *
 * カーソル先端 (親の 0, 0) から右下に小さくオフセットして描画する。
 * 位置決めは親要素 (CursorBundle) の責務。
 */

import { DefaultAvatar } from './DefaultAvatar';

interface NameplateProps {
    name: string;
    /** プロフィール画像 URL。未指定時はデフォルト SVG。 */
    avatarUrl?: string | null;
    /** デフォルトアバターのアクセント色 (penColor 等から借りる)。 */
    accentColor?: string | null;
    /** 自分自身かどうか。スタイルを少しだけ変える (ボーダー強調)。 */
    isSelf?: boolean;
}

const AVATAR_SIZE = 28;

export function Nameplate({ name, avatarUrl, accentColor, isSelf }: NameplateProps) {
    return (
        <div
            style={{
                position: 'absolute',
                left: 14, // カーソル先端の右下に重ねない程度のオフセット
                top: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
            }}
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
