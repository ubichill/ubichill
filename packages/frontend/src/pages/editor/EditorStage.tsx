import type { InitialEntity, WorldDefinition } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { EditOverlay } from './EditOverlay';
import { EditorPreview } from './EditorPreview';

interface EditorStageProps {
    definition: WorldDefinition;
    selectedIndex: number | null;
    hiddenIndices: Set<number>;
    onSelect: (i: number | null) => void;
    onPatchTransform: (index: number, patch: Partial<InitialEntity['transform']>) => void;
}

/**
 * 中央ドック: 実プラグインのライブビュー + 編集オーバーレイ。
 * 親 grid セルの 100% を埋めるため EditorPreview の高さを stretch する。
 */
export function EditorStage({
    definition,
    selectedIndex,
    hiddenIndices,
    onSelect,
    onPatchTransform,
}: EditorStageProps) {
    return (
        <main
            className={css({
                gridArea: 'center',
                position: 'relative',
                minH: 0,
                minW: 0,
                overflow: 'hidden',
                bg: 'background',
            })}
        >
            <EditorPreview
                definition={definition}
                hiddenIndices={hiddenIndices}
                fillContainer
                overlay={
                    <EditOverlay
                        entities={definition.spec.initialEntities}
                        selectedIndex={selectedIndex}
                        hiddenIndices={hiddenIndices}
                        onSelect={onSelect}
                        onPatchTransform={onPatchTransform}
                    />
                }
            />
        </main>
    );
}
