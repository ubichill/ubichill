import type { InitialEntity, WorldDefinition } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import type { EntityPath, FlatEntityNode } from '../lib/entityTree';
import { EditOverlay } from './EditOverlay';
import { EditorPreview } from './EditorPreview';

interface EditorStageProps {
    definition: WorldDefinition;
    flatNodes: FlatEntityNode[];
    selectedPath: EntityPath | null;
    hiddenPathKeys: Set<string>;
    hiddenRootIndices: Set<number>;
    /** 0 ならスナップ無効 (= worldSize clamp も無効、背景グリッドも非表示)。 */
    snapStep?: number;
    onSelect: (path: EntityPath | null) => void;
    onPatchTransform: (path: EntityPath, patch: Partial<InitialEntity['transform']>) => void;
    onDropComponent: (path: EntityPath, componentType: string) => void;
}

/** プレビュー本体 + 編集オーバーレイのコンテナ。 */
export function EditorStage({
    definition,
    flatNodes,
    selectedPath,
    hiddenPathKeys,
    hiddenRootIndices,
    snapStep,
    onSelect,
    onPatchTransform,
    onDropComponent,
}: EditorStageProps) {
    const worldSize = definition.spec.environment?.worldSize;
    return (
        <main
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onSelect(null);
            }}
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
                hiddenIndices={hiddenRootIndices}
                fillContainer
                gridStep={snapStep && snapStep > 0 ? snapStep : undefined}
                onBackgroundMouseDown={() => onSelect(null)}
                overlay={
                    <EditOverlay
                        nodes={flatNodes}
                        selectedPath={selectedPath}
                        hiddenPathKeys={hiddenPathKeys}
                        snapStep={snapStep}
                        worldSize={worldSize}
                        onSelect={onSelect}
                        onPatchTransform={onPatchTransform}
                        onDropComponent={onDropComponent}
                    />
                }
            />
        </main>
    );
}
