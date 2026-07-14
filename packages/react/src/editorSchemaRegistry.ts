import { useSyncExternalStore } from 'react';

/**
 * Worker が起動時に報告する「Inspector 用スキーマ」を componentType ごとに保持するレジストリ。
 *
 * 経緯:
 *   編集可能パラメータの定義を mod.json の dataFields ではなく Ubi.state（worker）に
 *   一本化したため、エディタはマニフェストではなく「走っている worker が報告したスキーマ」を
 *   使う。World エディタのプレビューは各エンティティの worker を実走させるので、その過程で
 *   ここにスキーマが溜まり、Inspector が型付き入力（配列の追加/削除含む）を描画する。
 *
 * schema は DataFields 互換の緩い形（Record<string, fieldSpec>）。
 */

type Schema = Record<string, unknown>;

const schemas = new Map<string, Schema>();
const listeners = new Set<() => void>();

function emit(): void {
    for (const fn of listeners) fn();
}

export const editorSchemaRegistry = {
    set(componentType: string, schema: Schema): void {
        const prev = schemas.get(componentType);
        // 同一内容なら通知しない（無駄な再レンダー防止）
        if (prev && JSON.stringify(prev) === JSON.stringify(schema)) return;
        schemas.set(componentType, schema);
        emit();
    },
    get(componentType: string): Schema | undefined {
        return schemas.get(componentType);
    },
    subscribe(fn: () => void): () => void {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
};

/** componentType に対応する Inspector スキーマを購読する（report 到着で再レンダー）。 */
export function useEditorSchema(componentType: string | undefined): Schema | undefined {
    return useSyncExternalStore(
        editorSchemaRegistry.subscribe,
        () => (componentType ? editorSchemaRegistry.get(componentType) : undefined),
        () => undefined,
    );
}
