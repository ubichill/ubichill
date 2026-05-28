/**
 * CursorIcon — カーソル先端の画像 (cursorUrl) または DefaultCursorIcon。
 *
 * 親要素の (0, 0) に重ねる純粋なプレゼンテーション。位置決めは親 (CursorBundle)。
 */

import { DefaultCursorIcon } from './DefaultCursorIcon';

interface CursorIconProps {
    cursorUrl?: string | null;
    /** 描画サイズ (px)。デフォルト 24。 */
    size?: number;
}

const DEFAULT_SIZE = 24;

export function CursorIcon({ cursorUrl, size = DEFAULT_SIZE }: CursorIconProps) {
    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: size,
                height: size,
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
