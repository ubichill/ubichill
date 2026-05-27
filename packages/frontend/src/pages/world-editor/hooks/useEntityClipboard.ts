import type { InitialEntity } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * エンティティのクリップボード。
 *
 * - 1 つの Entity (subtree) をモジュールスコープで保持
 * - `copy(entity)` でクリップへ、`peek()` で取り出し
 * - 複数の WorldEditorPage インスタンスが同時に存在する想定はない (シングルトン)
 * - リスナー登録で「クリップ内容が変わったとき」だけ再 render する
 */

let clipboardEntry: InitialEntity | null = null;
const listeners = new Set<() => void>();

function setClipboard(entity: InitialEntity | null): void {
    clipboardEntry = entity;
    for (const fn of listeners) fn();
}

export function useEntityClipboard(): {
    copy: (entity: InitialEntity) => void;
    peek: () => InitialEntity | null;
    hasClipboard: boolean;
} {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const fn = () => setVersion((v) => v + 1);
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    }, []);

    const copy = useCallback((entity: InitialEntity) => {
        // 構造クローンで「コピー後に元 entity が編集されてもクリップが汚染されない」を保証
        setClipboard(structuredClone(entity));
    }, []);

    const peek = useCallback(() => clipboardEntry, []);

    // version を依存に入れて hasClipboard が変化するたび再評価
    const hasClipboard = clipboardEntry !== null;
    void version;

    return { copy, peek, hasClipboard };
}
