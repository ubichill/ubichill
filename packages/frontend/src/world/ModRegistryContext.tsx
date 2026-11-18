import type { WorkerModDefinition } from '@ubichill/react';
import type { ModLock } from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { logConsole } from '@/lib/console/consoleStore';
import { loadVerifiedMod } from './modLoader';
import { modIdOfType, modRejectionLog, retryTargets } from './modRejection';
import type { ModSource } from './modSource';

// ============================================
// mod ローダー（取得 + lock 照合は modLoader.ts に委譲）
// このファイルは React の state / キャッシュだけを持つ。
// ============================================

// ============================================
// Types
// ============================================

/** mod（worker コード）のダウンロード進捗。total = 開始数 / completed = 完了数 */
export interface ModLoadingStatus {
    completed: number;
    total: number;
}

interface ModRegistryContextType {
    modMap: Map<string, WorkerModDefinition>;
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
    /** ワールドの mod 完全性ロック。固定されていない mod は、ワールドの置き場所に関係なく実行しない。 */
    lock?: ModLock;
    /** mod の取得元と、未署名の mod を許すか。 */
    source: ModSource;
    /** ブロックした人の作者アカウント（突き合わせる形）。この人たちが作った mod は実行しない */
    blockedAuthors?: ReadonlySet<string>;
}> = ({ children, onStatusChange, lock, source, blockedAuthors }) => {
    const [modMap, setModMap] = useState<Map<string, WorkerModDefinition>>(new Map());
    const [loadCounts, setLoadCounts] = useState<ModLoadingStatus>({ completed: 0, total: 0 });
    // 実行しなかった mod は画面に通知を出さず、コンソールに記録する（再試行はコンソールの行から）。
    // Component 型 → 実行しなかった理由
    const rejectionsRef = useRef(new Map<string, string>());
    // 記録した (mod, 理由)。同じ mod の別の Component が同じ理由で止まっても 1 回だけ記録する
    const loggedRef = useRef(new Set<string>());
    const retryingRef = useRef(new Set<string>());
    const retryRef = useRef<(modId: string) => void>(() => {});
    const pendingModCount = loadCounts.total - loadCounts.completed;

    useEffect(() => {
        onStatusChange?.(loadCounts);
    }, [loadCounts, onStatusChange]);
    // ロード済み（またはロード中）のエンティティタイプを追跡して重複ロードを防ぐ
    const loadingRef = useRef(new Set<string>());
    // 登録済みの mod id を追跡（StrictMode での二重呼び出し防止）
    const registeredRef = useRef(new Set<string>());

    const addMod = useCallback((def: WorkerModDefinition) => {
        if (registeredRef.current.has(def.id)) return;
        registeredRef.current.add(def.id);
        setModMap((prev) => {
            if (prev.has(def.id)) return prev;
            const next = new Map(prev);
            next.set(def.id, def);
            return next;
        });
    }, []);

    const loadMod = useCallback(
        (entityType: string) => {
            if (loadingRef.current.has(entityType)) return Promise.resolve(false);
            loadingRef.current.add(entityType);
            setLoadCounts((c) => ({ ...c, total: c.total + 1 }));
            const modId = modIdOfType(entityType);
            const clearRejection = () => {
                rejectionsRef.current.delete(entityType);
                if (retryTargets(rejectionsRef.current, modId).rejected === 0) forgetLogged(loggedRef.current, modId);
            };
            const reject = (reason: string) => {
                rejectionsRef.current.set(entityType, reason);
                loadingRef.current.delete(entityType);
                const key = `${modId}\n${reason}`;
                if (loggedRef.current.has(key)) return;
                loggedRef.current.add(key);
                logConsole(modRejectionLog(modId, reason, () => retryRef.current(modId)));
            };

            return loadVerifiedMod(entityType, { lock, source, blockedAuthors })
                .then((result) => {
                    if (typeof result === 'object' && 'workerCode' in result) {
                        addMod(result);
                        clearRejection();
                        return true;
                    }
                    if (result === 'data-only' || result === 'undeclared') {
                        // Worker の無いデータだけの entity（例: pen:stroke）。Worker を起動しない。
                        // 結果は変わらないので loadingRef に残し、同じ型の Entity が増えるたびに取り直さない（知らせるのも 1 回になる）。
                        // 宣言の無い型は、作った人向けにコンソールへ情報として残す（訪れた人には直せないので目立たせない）
                        if (result === 'undeclared') {
                            logConsole({
                                level: 'info',
                                source: modId,
                                message: `Component「${entityType}」は manifest に宣言されていないので、データとして扱います`,
                                detail: 'コードは実行しません。打ち間違いでなければ、mod の config に dataOnly: true を書いてください。',
                            });
                        }
                        clearRejection();
                        return true;
                    }
                    if (typeof result === 'object' && 'rejected' in result) {
                        // lock の照合か作者署名の確認に失敗した mod。実行しない。
                        reject(result.rejected);
                        return false;
                    }
                    // 'not-found': manifest・Worker が取れない（削除済みの mod・版を参照している、通信の失敗）。
                    reject('load-unavailable');
                    return false;
                })
                .catch((err) => {
                    console.error(`[ModRegistry] Failed to load mod: ${entityType}`, err);
                    reject('load-unavailable');
                    return false;
                })
                .finally(() => {
                    setLoadCounts((c) => ({ ...c, completed: c.completed + 1 }));
                });
        },
        [addMod, lock, source, blockedAuthors],
    );

    const retryMod = useCallback(
        async (modId: string) => {
            if (retryingRef.current.has(modId)) return;
            const { targets, rejected } = retryTargets(rejectionsRef.current, modId);
            if (targets.length === 0) return;
            retryingRef.current.add(modId);
            // 再試行しても通らなければ、もう一度記録する（押したのに何も起きないように見えないよう）
            forgetLogged(loggedRef.current, modId);
            try {
                const results = await Promise.all(targets.map(loadMod));
                if (results.every(Boolean))
                    logConsole({
                        level: 'info',
                        source: modId,
                        message: targets.length === rejected ? '読み込みました' : '一部の Component を読み込みました',
                    });
            } finally {
                retryingRef.current.delete(modId);
            }
        },
        [loadMod],
    );
    retryRef.current = (modId) => void retryMod(modId);

    // dependencies が登録されているからといって全 worker を一括起動しない。
    // シーン (initialEntities) に置かれたエンティティだけが EntityRenderer 経由で
    // loadMod される。singleton も同じく entity が無ければ起動しない。

    return (
        <ModRegistryContext.Provider value={{ modMap, pendingModCount, loadMod }}>
            {children}
        </ModRegistryContext.Provider>
    );
};

/** その mod について記録した理由を忘れる（読み込めた・再試行するときに、次の失敗をまた記録する）。 */
function forgetLogged(logged: Set<string>, modId: string): void {
    for (const key of [...logged]) if (key.startsWith(`${modId}\n`)) logged.delete(key);
}

// ============================================
// Hook
// ============================================

export const useModRegistry = () => useContext(ModRegistryContext);
