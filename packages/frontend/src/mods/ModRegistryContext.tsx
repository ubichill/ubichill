import type { WidgetDefinition, WorkerModDefinition } from '@ubichill/react';
import { isWorkerMod } from '@ubichill/react';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ============================================
// mod.json 自動ローダー
// ============================================

/**
 * ルート mod.json（バージョン index）。
 * npm の package endpoint と同様に「最新バージョンへのポインタ」としてのみ機能する。
 * エンティティ詳細はバージョン付きマニフェストに分離されている。
 */
interface ModIndex {
    id: string;
    name?: string;
    version: string;
}

/**
 * バージョン付きマニフェスト（/mods/<name>/v<ver>/manifest.json）の Component 定義。
 * ビルド時のみ必要な src フィールドは含まない。
 * workerUrl はバージョンディレクトリからの相対パス（例: "./cursor/index.js"）。
 *
 * workerUrl が無いエントリは「データ専用 Component」(mod.json で src 未定義) で、
 * worker は起動せず manifest 上のメタ情報のみを表す。
 */
interface WorkerMetaObject {
    workerUrl?: string;
    capabilities?: string[];
    singleton?: boolean;
    canvasTargets?: string[];
    watchEntityTypes?: string[];
    /** 'entity' | 'subtree' (default) | 'parent' | 'world' */
    watchScope?: 'entity' | 'subtree' | 'parent' | 'world';
    /** アセット相対パス */
    thumbnail?: string;
    mediaTargets?: string[];
    defaultTransform?: Record<string, unknown>;
    dataFields?: Record<string, unknown>;
}

/** バージョン付きマニフェスト全体（Stage 1: `components` キーで全 Component を `modId:componentName` 形式で保持） */
interface VersionedModJson {
    id: string;
    name?: string;
    version: string;
    components?: Record<string, WorkerMetaObject>;
}

/**
 * modのベースURL。
 * VITE_MOD_CDN_URL が設定されている場合はそちらを使う（外部CDN / GitHub Pages）。
 * 未設定の場合は自ホストの /mods/ に相対パスでアクセスする。
 */
const MOD_BASE_URL: string = (() => {
    const envUrl = import.meta.env.VITE_MOD_CDN_URL as string | undefined;
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/mods';
})();

/** mod名 → ルート index のキャッシュ */
const modIndexCache = new Map<string, Promise<ModIndex | null>>();
/** "modName@version" → バージョン付きマニフェストのキャッシュ */
const versionedManifestCache = new Map<string, Promise<VersionedModJson | null>>();

function fetchModIndex(modName: string): Promise<ModIndex | null> {
    if (!modIndexCache.has(modName)) {
        modIndexCache.set(
            modName,
            fetch(`${MOD_BASE_URL}/${modName}/mod.json`, { cache: 'no-store' })
                .then((r) => (r.ok ? (r.json() as Promise<ModIndex>) : null))
                .catch(() => null),
        );
    }
    return modIndexCache.get(modName) ?? Promise.resolve(null);
}

function fetchVersionedManifest(modName: string, version: string): Promise<VersionedModJson | null> {
    const key = `${modName}@${version}`;
    if (!versionedManifestCache.has(key)) {
        versionedManifestCache.set(
            key,
            // cache: 'no-store' — manifest はビルド毎に workerUrl のハッシュが変わるため、
            // 開発時に古いハッシュ参照を掴まされないようブラウザキャッシュを必ず迂回する。
            fetch(`${MOD_BASE_URL}/${modName}/v${version}/manifest.json`, { cache: 'no-store' })
                .then((r) => (r.ok ? (r.json() as Promise<VersionedModJson>) : null))
                .catch(() => null),
        );
    }
    return versionedManifestCache.get(key) ?? Promise.resolve(null);
}

/**
 * loadWorkerMod の戻り値。
 *  - 'data-only': manifest に宣言されているが workerUrl が無い純データ Component。
 *    spawn して持ち回るだけのエンティティ (例: pen:stroke)。warning は出さない。
 *  - 'not-found': manifest 取得失敗 / manifest に宣言されていない。古い YAML が
 *    廃止modを参照している可能性。warning を出して skip。
 */
type LoadResult = WorkerModDefinition | 'data-only' | 'not-found';

/**
 * Component 型 (`modName:componentName`) から WorkerModDefinition を構築する。
 * 該当するmodがない or workerUrl が無いデータ専用 Component の場合は null。
 */
async function loadWorkerMod(entityType: string): Promise<LoadResult> {
    const colonIdx = entityType.indexOf(':');
    if (colonIdx === -1) return 'not-found'; // entityType は必ずコロン形式

    const modName = entityType.slice(0, colonIdx);
    const index = await fetchModIndex(modName);
    if (!index?.version) return 'not-found';

    const manifest = await fetchVersionedManifest(modName, index.version);
    const entry = manifest?.components?.[entityType];
    if (!entry) return 'not-found';
    if (!entry.workerUrl) return 'data-only';

    const versionedBase = `${MOD_BASE_URL}/${modName}/v${index.version}`;
    const workerUrl = `${versionedBase}/${entry.workerUrl.replace(/^\.\//, '')}`;

    let workerCode: string;
    try {
        const res = await fetch(workerUrl);
        if (!res.ok) return 'not-found';
        // Vite の SPA fallback などで HTML が返ったとき (= worker file 404 で index.html が来る) は
        // text/javascript を期待しているので拒否する。これが無いと mod code に <!DOCTYPE html>
        // が入って sandbox の new Function() が `Unexpected token '<'` で死ぬ。
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('javascript') && !ct.includes('text/plain') && ct !== '') {
            console.warn(`[ModRegistry] worker fetch returned non-JS content-type "${ct}" for ${entityType}`);
            return 'not-found';
        }
        workerCode = await res.text();
    } catch {
        return 'not-found';
    }

    const def: WorkerModDefinition = {
        id: entityType,
        name: `${manifest?.name ?? modName} - ${entityType.slice(colonIdx + 1)}`,
        workerCode,
        capabilities: entry.capabilities,
        singleton: entry.singleton,
        canvasTargets: entry.canvasTargets,
        watchEntityTypes: entry.watchEntityTypes,
        watchScope: entry.watchScope ?? 'subtree',
        thumbnail: entry.thumbnail,
        mediaTargets: entry.mediaTargets,
        modBase: versionedBase,
    };
    return def;
}

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
}> = ({ children, onStatusChange }) => {
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

            loadWorkerMod(entityType)
                .then((result) => {
                    if (typeof result === 'object') {
                        addMod(result);
                        return;
                    }
                    if (result === 'data-only') {
                        // manifest に宣言されているがworkerなし。spawn して持ち回るだけのエンティティ
                        // (例: pen:stroke)。Worker を起動しないし、警告も出さない。
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
        [addMod],
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
