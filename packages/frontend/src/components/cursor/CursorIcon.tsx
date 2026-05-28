/**
 * CursorIcon — マウス先端 (viewport の x, y) に重ねる小型カーソル画像。
 *
 * 役割の区別:
 *  - これは「カーソルそのもの」を置き換える視覚要素 (user.cursorUrl)
 *  - 名前/プロフィール画像は <Nameplate> 側 (user.avatarUrl) が担当
 *
 * `cursorUrl` 未設定時は OS のデフォルト矢印で代用するため何も描画しない。
 * 設定時は OS カーソルを CSS で消して二重表示を避ける (CursorLayer 側で制御)。
 */

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
    if (!cursorUrl) return null;
    return (
        <img
            src={cursorUrl}
            alt=""
            style={{
                position: 'fixed',
                left: x,
                top: y,
                width: size,
                height: size,
                // 多くのカーソル画像は左上が先端 (hotspot)。要件が増えたら hotspot offset を追加する。
                transform: 'translate(0, 0)',
                pointerEvents: 'none',
                zIndex,
                userSelect: 'none',
                imageRendering: 'auto',
            }}
            draggable={false}
        />
    );
}
