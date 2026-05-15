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
    onSelect,
    onPatchTransform,
    onDropComponent,
}: EditorStageProps) {
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
                onBackgroundMouseDown={() => onSelect(null)}
                overlay={
                    <EditOverlay
                        nodes={flatNodes}
                        selectedPath={selectedPath}
                        hiddenPathKeys={hiddenPathKeys}
                        onSelect={onSelect}
                        onPatchTransform={onPatchTransform}
                        onDropComponent={onDropComponent}
                    />
                }
            />
        </main>
    );
}
