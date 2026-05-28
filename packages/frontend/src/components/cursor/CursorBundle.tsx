/**
 * CursorBundle — カーソルアイコン + ネームプレートを 1 つにまとめた visual。
 *
 * **位置決めは親要素の責務**。CursorBundle 自身は `position: absolute` で wrapper の
 * 左上 (0, 0) を基準にカーソル先端を出す。親が transform / position で動かす。
 *
 * - SelfCursor: 親が `position: fixed` + clientX/Y で配置 (viewport 基準)
 * - RemoteCursor: 親が scroll container 内に `position: absolute` + worldX/Y で配置
 *
 * 「親の側で動かす」ことで:
 *  - リモートカーソルは scroll 中に native スクロールに付いてくる (React 再render なし)
 *  - GPU 加速の translate3d + CSS transition で間欠 broadcast 間も滑らかに見える
 */

import { CursorIcon } from './CursorIcon';
import { Nameplate } from './Nameplate';

interface CursorBundleProps {
    cursorUrl?: string | null;
    name: string;
    avatarUrl?: string | null;
    accentColor?: string | null;
    isSelf?: boolean;
}

export function CursorBundle({ cursorUrl, name, avatarUrl, accentColor, isSelf }: CursorBundleProps) {
    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                pointerEvents: 'none',
                userSelect: 'none',
            }}
        >
            {/* カーソル先端 (wrapper の 0, 0) */}
            <CursorIcon cursorUrl={cursorUrl} />
            {/* ネームプレートは右下にオフセット */}
            <Nameplate name={name} avatarUrl={avatarUrl} accentColor={accentColor} isSelf={isSelf} />
        </div>
    );
}
