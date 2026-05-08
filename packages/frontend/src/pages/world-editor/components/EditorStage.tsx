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
    // 背景（プラグイン UI のない場所）クリックで選択解除する。
    // EditOverlay 自体は pointer-events:none のため背景クリックを拾えないので、
    // ここで mousedown を受ける。エンティティハンドルは stopPropagation でブロックする。
    const handleStageMouseDown = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onSelect(null);
    };

    return (
        <main
            onMouseDown={handleStageMouseDown}
            className={css({
                position: 'relative',
                minH: 0,
                minW: 0,
                overflow: 'hidden',
                bg: 'background',
                width: 'full',
                height: 'full',
            })}
        >
            <EditorPreview
                definition={definition}
                hiddenIndices={hiddenIndices}
                fillContainer
                onBackgroundMouseDown={() => onSelect(null)}
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
