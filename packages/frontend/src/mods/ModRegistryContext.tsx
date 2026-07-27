import type { WidgetDefinition, WorkerModDefinition } from '@ubichill/react';
import { isWorkerMod } from '@ubichill/react';
import { type ModLock, WorldSourceKind } from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadVerifiedMod } from './modLoader';

// ============================================
// mod ローダー（取得 + lock 照合は modLoader.ts に委譲）
// このファイルは React の state / キャッシュ / register だけを持つ。
// ============================================

// ============================================
// Types
// ============================================

export type AnyModDefinition = WidgetDefinition | WorkerModDefinition;

/** mod（worker コード）のダウンロード進捗。total = 開始数 / completed = 完了数 */
export interface ModLoadingStatus {
    completed: number;
    total: number;
}

interface ModRegistryContextType {
    modMap: Map<string, AnyModDefinition>;
    /** フェッチ中のmod数 */
    pendingModCount: number;
    /** エンティティタイプを指定してmodを動的ロードする（未ロードの場合のみ実行） */
    loadMod: (entityType: string) => void;
}

// ============================================
// Context
// ============================================

const ModRegistryContext = createContext<ModRegistryContextType>({
    modMap: new Map(),
    pendingModCount: 0,
    loadMod: () => {},
});

// ============================================
// Provider
// ============================================

export const ModRegistryProvider: React.FC<{
    children: React.ReactNode;
    onStatusChange?: (status: ModLoadingStatus) => void;
    /** ワールドに焼かれた mod 完全性ロック。外部 provenance では hash 照合に使う。 */
    lock?: ModLock;
    /**
     * ワールドの provenance kind（local/github/...）。lock enforcement の分岐に使う。
     * 未指定（エディタプレビュー等）は local として寛容に扱う。
     */
    sourceKind?: string;
}> = ({ children, onStatusChange, lock, sourceKind = WorldSourceKind.Local }) => {
    const [modMap, setModMap] = useState<Map<string, AnyModDefinition>>(new Map());
    const [loadCounts, setLoadCounts] = useState<ModLoadingStatus>({ completed: 0, total: 0 });
    const pendingModCount = loadCounts.total - loadCounts.completed;

    useEffect(() => {
        onStatusChange?.(loadCounts);
    }, [loadCounts, onStatusChange]);
    // ロード済み（またはロード中）のエンティティタイプを追跡して重複ロードを防ぐ
    const loadingRef = useRef(new Set<string>());
    // register() 呼び出し済みの mod id を追跡（StrictMode での二重呼び出し防止）
    const registeredRef = useRef(new Set<string>());

    const addMod = useCallback((def: AnyModDefinition) => {
        if (registeredRef.current.has(def.id)) return;
        registeredRef.current.add(def.id);

        if (isWorkerMod(def)) {
            // WorkerModDefinition は CE 不要。即座にマップへ追加する。
            setModMap((prev) => {
                if (prev.has(def.id)) return prev;
                const next = new Map(prev);
                next.set(def.id, def);
                return next;
            });
            return;
        }

        // CE クラスの import() + define() を開始
        def.register();

        // elementTag の define が完了してから modMap に追加する。
        const allTags = [def.elementTag];
        Promise.all(allTags.map((tag) => customElements.whenDefined(tag))).then(() => {
            setModMap((prev) => {
                if (prev.has(def.id)) return prev;
                const next = new Map(prev);
                next.set(def.id, def);
                return next;
            });
        });
    }, []);

    const loadMod = useCallback(
        (entityType: string) => {
            if (loadingRef.current.has(entityType)) return;
            loadingRef.current.add(entityType);
            setLoadCounts((c) => ({ ...c, total: c.total + 1 }));

            loadVerifiedMod(entityType, { lock, sourceKind })
                .then((result) => {
                    if (typeof result === 'object' && 'workerCode' in result) {
                        addMod(result);
                        return;
                    }
                    if (result === 'data-only') {
                        // manifest に宣言されているがworkerなし。spawn して持ち回るだけのエンティティ
                        // (例: pen:stroke)。Worker を起動しないし、警告も出さない。
                        loadingRef.current.delete(entityType);
                        return;
                    }
                    if (typeof result === 'object' && 'rejected' in result) {
                        // lock 照合に失敗した外部 mod。安全のため実行しない。
                        console.warn(
                            `[ModRegistry] component "${entityType}" は lock 照合に失敗 (${result.rejected})。実行を拒否します。`,
                        );
                        loadingRef.current.delete(entityType);
                        return;
                    }
                    // 'not-found': manifest が無い or 宣言されていない。古い YAML が削除済み
                    // modを参照している可能性。警告だけ出して silently 無視する。
                    console.warn(
                        `[ModRegistry] component "${entityType}" のmodが見つかりませんでした。スキップします。`,
                    );
                    loadingRef.current.delete(entityType);
                })
                .catch((err) => {
                    console.error(`[ModRegistry] Failed to load mod: ${entityType}`, err);
                    loadingRef.current.delete(entityType);
                })
                .finally(() => {
                    setLoadCounts((c) => ({ ...c, completed: c.completed + 1 }));
                });
        },
        [addMod, lock, sourceKind],
    );

    // dependencies が登録されているからといって全 worker を一括起動しない。
    // シーン (initialEntities) に置かれたエンティティだけが EntityRenderer 経由で
    // loadMod される。singleton も同じく entity が無ければ起動しない。

    return (
        <ModRegistryContext.Provider value={{ modMap, pendingModCount, loadMod }}>
            {children}
        </ModRegistryContext.Provider>
    );
};

// ============================================
// Hook
// ============================================

export const useModRegistry = () => useContext(ModRegistryContext);
