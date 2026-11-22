import type { InitialEntity, WorldDefinition } from '@ubichill/shared';
import type { RefObject } from 'react';
import { css } from '@/styled-system/css';
import type { PrefabDragRef } from '../lib/dnd';
import type { EntityPath, FlatEntityNode } from '../lib/entityTree';
import { EditOverlay } from './EditOverlay';
import { EditorPreview } from './EditorPreview';
import { ThumbnailCamera, type ThumbnailTaken } from './ThumbnailCamera';

interface EditorStageProps {
    definition: WorldDefinition;
    flatNodes: FlatEntityNode[];
    selectedPath: EntityPath | null;
    hiddenPathKeys: Set<string>;
    hiddenRootIndices: Set<number>;
    /** 0 ならスナップ無効 (= worldSize clamp も無効、背景グリッドも非表示)。 */
    snapStep?: number;
    /** プレビューの外枠（見えている範囲の真ん中を求めるのと、サムネイルを撮るのに使う）。 */
    rootRef: RefObject<HTMLDivElement | null>;
    onSelect: (path: EntityPath | null) => void;
    onPatchTransform: (path: EntityPath, patch: Partial<InitialEntity['transform']>) => void;
    onDropComponent: (path: EntityPath, componentType: string) => void;
    onDropComponentAt: (componentType: string, point: { x: number; y: number }) => void;
    onDropPrefab: (ref: PrefabDragRef, point: { x: number; y: number }) => void;
    /** サムネイルを撮っている間だけ渡す。部屋で見える通りに描き、編集の枠を出さない */
    camera?: { onTaken: (taken: ThumbnailTaken) => void; onCancel: () => void } | null;
}

/** プレビューの見えている範囲の真ん中（ワールド座標）。まだ描いていなければ null。 */
export function stageViewCenter(root: HTMLElement | null): { x: number; y: number } | null {
    const world = root?.querySelector<HTMLElement>('[data-editor-world]');
    if (!root || !world) return null;
    const view = root.getBoundingClientRect();
    const origin = world.getBoundingClientRect();
    return {
        x: Math.round(view.left + view.width / 2 - origin.left),
        y: Math.round(view.top + view.height / 2 - origin.top),
    };
}

/** プレビュー本体 + 編集オーバーレイのコンテナ。 */
export function EditorStage({
    definition,
    flatNodes,
    selectedPath,
    hiddenPathKeys,
    hiddenRootIndices,
    snapStep,
    rootRef,
    onSelect,
    onPatchTransform,
    onDropComponent,
    onDropComponentAt,
    onDropPrefab,
    camera,
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
                gridStep={!camera && snapStep && snapStep > 0 ? snapStep : undefined}
                onBackgroundMouseDown={() => onSelect(null)}
                roomLook={!!camera}
                rootRef={rootRef}
                overlay={
                    camera ? undefined : (
                        <EditOverlay
                            entities={definition.spec.initialEntities}
                            nodes={flatNodes}
                            selectedPath={selectedPath}
                            hiddenPathKeys={hiddenPathKeys}
                            snapStep={snapStep}
                            worldSize={worldSize}
                            onSelect={onSelect}
                            onPatchTransform={onPatchTransform}
                            onDropComponent={onDropComponent}
                            onDropComponentAt={onDropComponentAt}
                            onDropPrefab={onDropPrefab}
                        />
                    )
                }
            />
            {camera && <ThumbnailCamera target={rootRef} onTaken={camera.onTaken} onCancel={camera.onCancel} />}
        </main>
    );
}
