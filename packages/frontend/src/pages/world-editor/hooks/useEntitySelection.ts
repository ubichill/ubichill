/**
 * Inspector / Hierarchy / Stage で共有する選択状態 & 表示/非表示マスク。
 *
 * 持っている state:
 *   - selectedPath: 選択中の entity の path (null = 何も選択していない)
 *   - selectedComponentIndex: 選択中の component の index (null なら entity 自体)
 *   - hiddenPaths: 非表示にした entity の pathKey 集合
 *
 * `hiddenRootIndices` は Stage / EditorPreview 用に「ルートだけの index」を導出する。
 */
import { useCallback, useMemo, useState } from 'react';
import type { EntityPath } from '../lib/entityTree';
import { pathKey } from '../lib/entityTree';

export interface UseEntitySelectionResult {
    selectedPath: EntityPath | null;
    selectedComponentIndex: number | null;
    hiddenPaths: Set<string>;
    /** ルート entity (= path 長 1) のみの index Set。Stage 描画フィルタで使う。 */
    hiddenRootIndices: Set<number>;

    selectEntity: (path: EntityPath | null) => void;
    selectComponent: (componentIndex: number | null) => void;
    toggleHidden: (path: EntityPath) => void;

    /** 直接 set する必要がある callback 用に露出 (entity 削除/移動時の調整など) */
    setSelectedPath: React.Dispatch<React.SetStateAction<EntityPath | null>>;
    setSelectedComponentIndex: React.Dispatch<React.SetStateAction<number | null>>;
    setHiddenPaths: React.Dispatch<React.SetStateAction<Set<string>>>;

    /** モバイル右パネル開閉用に「選択時にデフォルトで開かない」フラグを返すための副作用 */
    onSelectDidUnselect: boolean;
}

export function useEntitySelection(): UseEntitySelectionResult {
    const [selectedPath, setSelectedPath] = useState<EntityPath | null>(null);
    const [selectedComponentIndex, setSelectedComponentIndex] = useState<number | null>(null);
    const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set());

    const selectEntity = useCallback((path: EntityPath | null) => {
        setSelectedPath(path);
        if (path === null) setSelectedComponentIndex(null);
    }, []);

    const selectComponent = useCallback((componentIndex: number | null) => {
        setSelectedComponentIndex(componentIndex);
    }, []);

    const toggleHidden = useCallback((path: EntityPath) => {
        const key = pathKey(path);
        setHiddenPaths((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const hiddenRootIndices = useMemo(() => {
        const out = new Set<number>();
        for (const key of hiddenPaths) {
            if (!key.includes('-')) {
                const n = Number.parseInt(key, 10);
                if (Number.isFinite(n)) out.add(n);
            }
        }
        return out;
    }, [hiddenPaths]);

    return {
        selectedPath,
        selectedComponentIndex,
        hiddenPaths,
        hiddenRootIndices,
        selectEntity,
        selectComponent,
        toggleHidden,
        setSelectedPath,
        setSelectedComponentIndex,
        setHiddenPaths,
        onSelectDidUnselect: selectedPath === null,
    };
}
