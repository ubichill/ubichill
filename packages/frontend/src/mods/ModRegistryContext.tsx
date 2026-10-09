import type { WidgetDefinition, WorkerModDefinition } from '@ubichill/react';
import { isWorkerMod } from '@ubichill/react';
import type { ModLock } from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pushToast } from '@/lib/toast';
import { ModRejectionNotice } from './ModRejectionNotice';
import { loadVerifiedMod } from './modLoader';
import { describeModRejection, groupRejections, type RejectedMod } from './modRejection';

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
    /** 検証に失敗して実行しなかった mod（理由つき）。 */
    rejectedMods: RejectedMod[];
    /** 実行しなかった mod を読み込み直す（作者をいま確認できなかった場合など）。 */
    retryRejected: (mod: RejectedMod) => void;
}

// ============================================
// Context
// ============================================

const ModRegistryContext = createContext<ModRegistryContextType>({
    modMap: new Map(),
    pendingModCount: 0,
    loadMod: () => {},
    rejectedMods: [],
    retryRejected: () => {},
});

// ============================================
// Provider
// ============================================

export const ModRegistryProvider: React.FC<{
    children: React.ReactNode;
    onStatusChange?: (status: ModLoadingStatus) => void;
    /** ワールドの mod 完全性ロック。固定されていない mod は、ワールドの置き場所に関係なく実行しない。 */
    lock?: ModLock;
}> = ({ children, onStatusChange, lock }) => {
    const [modMap, setModMap] = useState<Map<string, AnyModDefinition>>(new Map());
    const [loadCounts, setLoadCounts] = useState<ModLoadingStatus>({ completed: 0, total: 0 });
    // Component 型 → 実行しなかった理由
    const [rejections, setRejections] = useState<ReadonlyMap<string, string>>(new Map());
    const [retryingMods, setRetryingMods] = useState<ReadonlySet<string>>(new Set());
    const rejectedMods = useMemo(() => groupRejections(rejections), [rejections]);
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
            if (loadingRef.current.has(entityType)) return Promise.resolve(false);
            loadingRef.current.add(entityType);
            setLoadCounts((c) => ({ ...c, total: c.total + 1 }));
            const clearRejection = () =>
                setRejections((prev) => {
                    if (!prev.has(entityType)) return prev;
                    const next = new Map(prev);
                    next.delete(entityType);
                    return next;
                });

            return loadVerifiedMod(entityType, { lock })
                .then((result) => {
                    if (typeof result === 'object' && 'workerCode' in result) {
                        addMod(result);
                        clearRejection();
                        return true;
                    }
                    if (result === 'data-only') {
                        // manifest に宣言されているがworkerなし。spawn して持ち回るだけのエンティティ
                        // (例: pen:stroke)。Worker を起動しないし、警告も出さない。
                        loadingRef.current.delete(entityType);
                        clearRejection();
                        return true;
                    }
                    if (typeof result === 'object' && 'rejected' in result) {
                        // lock の照合か作者署名の確認に失敗した mod。実行しない。
                        console.warn(
                            `[ModRegistry] component "${entityType}" は検証に失敗 (${result.rejected})。実行を拒否します。`,
                        );
                        setRejections((prev) => new Map(prev).set(entityType, result.rejected));
                        loadingRef.current.delete(entityType);
                        return false;
                    }
                    // 'not-found': manifest が無い or 宣言されていない。古い YAML が削除済み
                    // mod を参照している可能性。取得失敗の理由を画面にも出す。
                    console.warn(
                        `[ModRegistry] component "${entityType}" のmodが見つかりませんでした。スキップします。`,
                    );
                    setRejections((prev) => new Map(prev).set(entityType, 'load-unavailable'));
                    loadingRef.current.delete(entityType);
                    return false;
                })
                .catch((err) => {
                    console.error(`[ModRegistry] Failed to load mod: ${entityType}`, err);
                    setRejections((prev) => new Map(prev).set(entityType, 'load-unavailable'));
                    loadingRef.current.delete(entityType);
                    return false;
                })
                .finally(() => {
                    setLoadCounts((c) => ({ ...c, completed: c.completed + 1 }));
                });
        },
        [addMod, lock],
    );

    const retryRejected = useCallback(
        async (mod: RejectedMod) => {
            if (retryingMods.has(mod.modId)) return;
            const targets = mod.entityTypes.filter(
                (type) => describeModRejection(rejections.get(type) ?? '').retryable,
            );
            if (targets.length === 0) return;
            setRetryingMods((prev) => new Set(prev).add(mod.modId));
            try {
                const results = await Promise.all(targets.map(loadMod));
                if (results.every(Boolean))
                    pushToast(
                        targets.length === mod.entityTypes.length
                            ? `${mod.modId} を読み込みました`
                            : `${mod.modId} の一部の部品を読み込みました`,
                        'info',
                    );
            } finally {
                setRetryingMods((prev) => {
                    const next = new Set(prev);
                    next.delete(mod.modId);
                    return next;
                });
            }
        },
        [loadMod, rejections, retryingMods],
    );

    // dependencies が登録されているからといって全 worker を一括起動しない。
    // シーン (initialEntities) に置かれたエンティティだけが EntityRenderer 経由で
    // loadMod される。singleton も同じく entity が無ければ起動しない。

    return (
        <ModRegistryContext.Provider value={{ modMap, pendingModCount, loadMod, rejectedMods, retryRejected }}>
            {children}
            <ModRejectionNotice mods={rejectedMods} retryingMods={retryingMods} onRetry={retryRejected} />
        </ModRegistryContext.Provider>
    );
};

// ============================================
// Hook
// ============================================

export const useModRegistry = () => useContext(ModRegistryContext);
