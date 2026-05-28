/**
 * CursorIcon — マウス先端 (viewport の x, y) に重ねるカーソル画像。
 *
 * 役割の区別:
 *  - これは「カーソルそのもの」(user.cursorUrl)
 *  - 名前/プロフィール画像は <Nameplate> 側 (user.avatarUrl) が担当
 *
 * `cursorUrl` が未設定でも DefaultCursorIcon (矢印 SVG) にフォールバックする。
 * OS カーソルは CursorLayer 側で常時非表示にしているので、必ず何かが見える。
 */

import { DefaultCursorIcon } from './DefaultCursorIcon';

interface CursorIconProps {
    x: number;
    y: number;
    cursorUrl?: string | null;
    /** 描画サイズ (px)。デフォルト 24。 */
    size?: number;
    zIndex?: number;
}

const DEFAULT_SIZE = 24;

export function CursorIcon({ x, y, cursorUrl, size = DEFAULT_SIZE, zIndex = 10000 }: CursorIconProps) {
    return (
        <div
            style={{
                position: 'fixed',
                left: x,
                top: y,
                width: size,
                height: size,
                pointerEvents: 'none',
                zIndex,
                userSelect: 'none',
                // 多くのカーソル画像は (0,0) が先端 (hotspot)。要件が増えたら hotspot offset を追加する。
            }}
        >
            {cursorUrl ? (
                <img
                    src={cursorUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', imageRendering: 'auto', display: 'block' }}
                    draggable={false}
                />
            ) : (
                <DefaultCursorIcon size={size} />
            )}
        </div>
    );
}
