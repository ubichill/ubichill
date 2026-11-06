import { UiDataSchema } from '@ubichill/core-components';
import { ModUIMount } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import { parseUiMarkup } from '@ubichill/ui-renderer';
import type React from 'react';
import { useMemo } from 'react';
import { surfacePlacement } from './surfacePlacement';

/** core:ui はハンドラーを持たない（on* 属性は解析で捨てる）。届いても何もしない。 */
const ignoreAction = (): void => {};

/**
 * `core:ui` の面。ワールド作者が書いた HTML 風の UI データを、mod の UI と同じ描画（Shadow DOM・
 * 許可リスト・URL と style の検査）で描く。リンクを押せるよう、面は入力を受け取る。
 */
export const CoreUiPanel: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const parsed = UiDataSchema.safeParse(entity.data ?? {});
    const markup = parsed.success ? parsed.data.markup : '';
    const vnode = useMemo(() => parseUiMarkup(markup), [markup]);
    const entityId = entity.entityId ?? entity.id;
    return (
        <div data-ui-panel={entityId} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
            <ModUIMount targetId={entityId} vnode={vnode} sendAction={ignoreAction} />
        </div>
    );
};
