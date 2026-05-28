/**
 * CursorBundle — カーソルアイコン + (オプションで) ネームプレートをまとめた visual。
 *
 * 位置決めは親要素の責務:
 *  - SelfCursor: `position: fixed` + clientX/Y で配置 (viewport 基準、nameplate 非表示)
 *  - RemoteCursor: scroll container 内に `position: absolute` + worldX/Y で配置
 *
 * 自分の cursor には nameplate を出さない (`showNameplate=false`)。
 *  - 自分の名前は自分で知ってるし、UI ノイズが増えると「自分の手」感が薄れる
 *  - 視線が cursor 先端に集中する状態を保ちたい
 */

import { CursorIcon } from './CursorIcon';
import { Nameplate } from './Nameplate';

interface CursorBundleProps {
    cursorUrl?: string | null;
    name: string;
    avatarUrl?: string | null;
    accentColor?: string | null;
    /** false の場合はネームプレート (アバター + 名前) を描画しない。自分用。 */
    showNameplate?: boolean;
}

export function CursorBundle({ cursorUrl, name, avatarUrl, accentColor, showNameplate = true }: CursorBundleProps) {
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
            {/* ネームプレートは cursor の上 (リモートのみ) */}
            {showNameplate && <Nameplate name={name} avatarUrl={avatarUrl} accentColor={accentColor} />}
        </div>
    );
}
