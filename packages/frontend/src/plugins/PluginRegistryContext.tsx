import type { WidgetDefinition, WorkerPluginDefinition } from '@ubichill/react';
import { isWorkerPlugin } from '@ubichill/react';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ============================================
// plugin.json 自動ローダー
// ============================================

/**
 * ルート plugin.json（バージョン index）。
 * npm の package endpoint と同様に「最新バージョンへのポインタ」としてのみ機能する。
 * エンティティ詳細はバージョン付きマニフェストに分離されている。
 */
interface PluginIndex {
    id: string;
    name?: string;
    version: string;
}

/**
 * バージョン付きマニフェスト（/plugins/<name>/v<ver>/manifest.json）の Component 定義。
 * ビルド時のみ必要な src フィールドは含まない。
 * workerUrl はバージョンディレクトリからの相対パス（例: "./cursor/index.js"）。
 *
 * workerUrl が無いエントリは「データ専用 Component」(plugin.json で src 未定義) で、
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
    fetchDomains?: string[];
    defaultTransform?: Record<string, unknown>;
    dataFields?: Record<string, unknown>;
}

/** バージョン付きマニフェスト全体（Stage 1: `components` キーで全 Component を `pluginId:componentName` 形式で保持） */
interface VersionedPluginJson {
    id: string;
    name?: string;
    version: string;
    components?: Record<string, WorkerMetaObject>;
}

/**
 * プラグインのベースURL。
 * VITE_PLUGIN_CDN_URL が設定されている場合はそちらを使う（外部CDN / GitHub Pages）。
 * 未設定の場合は自ホストの /plugins/ に相対パスでアクセスする。
 */
const PLUGIN_BASE_URL: string = (() => {
    const envUrl = import.meta.env.VITE_PLUGIN_CDN_URL as string | undefined;
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/plugins';
})();

/** プラグイン名 → ルート index のキャッシュ */
const pluginIndexCache = new Map<string, Promise<PluginIndex | null>>();
/** "pluginName@version" → バージョン付きマニフェストのキャッシュ */
const versionedManifestCache = new Map<string, Promise<VersionedPluginJson | null>>();

function fetchPluginIndex(pluginName: string): Promise<PluginIndex | null> {
    if (!pluginIndexCache.has(pluginName)) {
        pluginIndexCache.set(
            pluginName,
            fetch(`${PLUGIN_BASE_URL}/${pluginName}/plugin.json`, { cache: 'no-store' })
                .then((r) => (r.ok ? (r.json() as Promise<PluginIndex>) : null))
                .catch(() => null),
        );
    }
    return pluginIndexCache.get(pluginName) ?? Promise.resolve(null);
}

function fetchVersionedManifest(pluginName: string, version: string): Promise<VersionedPluginJson | null> {
    const key = `${pluginName}@${version}`;
    if (!versionedManifestCache.has(key)) {
        versionedManifestCache.set(
            key,
            // cache: 'no-store' — manifest はビルド毎に workerUrl のハッシュが変わるため、
            // 開発時に古いハッシュ参照を掴まされないようブラウザキャッシュを必ず迂回する。
            fetch(`${PLUGIN_BASE_URL}/${pluginName}/v${version}/manifest.json`, { cache: 'no-store' })
                .then((r) => (r.ok ? (r.json() as Promise<VersionedPluginJson>) : null))
                .catch(() => null),
        );
    }
    return versionedManifestCache.get(key) ?? Promise.resolve(null);
}

/**
 * loadWorkerPlugin の戻り値。
 *  - 'data-only': manifest に宣言されているが workerUrl が無い純データ Component。
 *    spawn して持ち回るだけのエンティティ (例: pen:stroke)。warning は出さない。
 *  - 'not-found': manifest 取得失敗 / manifest に宣言されていない。古い YAML が
 *    廃止プラグインを参照している可能性。warning を出して skip。
 */
type LoadResult = WorkerPluginDefinition | 'data-only' | 'not-found';

/**
 * Component 型 (`pluginName:componentName`) から WorkerPluginDefinition を構築する。
 * 該当するプラグインがない or workerUrl が無いデータ専用 Component の場合は null。
 */
async function loadWorkerPlugin(entityType: string): Promise<LoadResult> {
    const colonIdx = entityType.indexOf(':');
    if (colonIdx === -1) return 'not-found'; // entityType は必ずコロン形式

    const pluginName = entityType.slice(0, colonIdx);
    const index = await fetchPluginIndex(pluginName);
    if (!index?.version) return 'not-found';

    const manifest = await fetchVersionedManifest(pluginName, index.version);
    const entry = manifest?.components?.[entityType];
    if (!entry) return 'not-found';
    if (!entry.workerUrl) return 'data-only';

    const versionedBase = `${PLUGIN_BASE_URL}/${pluginName}/v${index.version}`;
    const workerUrl = `${versionedBase}/${entry.workerUrl.replace(/^\.\//, '')}`;

    let workerCode: string;
    try {
        const res = await fetch(workerUrl);
        if (!res.ok) return 'not-found';
        workerCode = await res.text();
    } catch {
        return 'not-found';
    }

    const def: WorkerPluginDefinition = {
        id: entityType,
        name: `${manifest?.name ?? pluginName} - ${entityType.slice(colonIdx + 1)}`,
        workerCode,
        capabilities: entry.capabilities,
        singleton: entry.singleton,
        canvasTargets: entry.canvasTargets,
        watchEntityTypes: entry.watchEntityTypes,
        watchScope: entry.watchScope ?? 'subtree',
        thumbnail: entry.thumbnail,
        mediaTargets: entry.mediaTargets,
        fetchDomains: entry.fetchDomains,
        pluginBase: versionedBase,
    };
    return def;
}

// ============================================
// Types
// ============================================

export type AnyPluginDefinition = WidgetDefinition | WorkerPluginDefinition;

/** プラグイン（worker コード）のダウンロード進捗。total = 開始数 / completed = 完了数 */
export interface PluginLoadingStatus {
    completed: number;
    total: number;
}

interface PluginRegistryContextType {
    pluginMap: Map<string, AnyPluginDefinition>;
    /** フェッチ中のプラグイン数 */
    pendingPluginCount: number;
    /** エンティティタイプを指定してプラグインを動的ロードする（未ロードの場合のみ実行） */
    loadPlugin: (entityType: string) => void;
}

// ============================================
// Context
// ============================================

const PluginRegistryContext = createContext<PluginRegistryContextType>({
    pluginMap: new Map(),
    pendingPluginCount: 0,
    loadPlugin: () => {},
});

// ============================================
// Provider
// ============================================

export const PluginRegistryProvider: React.FC<{
    children: React.ReactNode;
    onStatusChange?: (status: PluginLoadingStatus) => void;
}> = ({ children, onStatusChange }) => {
    const [pluginMap, setPluginMap] = useState<Map<string, AnyPluginDefinition>>(new Map());
    const [loadCounts, setLoadCounts] = useState<PluginLoadingStatus>({ completed: 0, total: 0 });
    const pendingPluginCount = loadCounts.total - loadCounts.completed;

    useEffect(() => {
        onStatusChange?.(loadCounts);
    }, [loadCounts, onStatusChange]);
    // ロード済み（またはロード中）のエンティティタイプを追跡して重複ロードを防ぐ
    const loadingRef = useRef(new Set<string>());
    // register() 呼び出し済みの plugin id を追跡（StrictMode での二重呼び出し防止）
    const registeredRef = useRef(new Set<string>());

    const addPlugin = useCallback((def: AnyPluginDefinition) => {
        if (registeredRef.current.has(def.id)) return;
        registeredRef.current.add(def.id);

        if (isWorkerPlugin(def)) {
            // WorkerPluginDefinition は CE 不要。即座にマップへ追加する。
            setPluginMap((prev) => {
                if (prev.has(def.id)) return prev;
                const next = new Map(prev);
                next.set(def.id, def);
                return next;
            });
            return;
        }

        // CE クラスの import() + define() を開始
        def.register();

        // elementTag の define が完了してから pluginMap に追加する。
        const allTags = [def.elementTag];
        Promise.all(allTags.map((tag) => customElements.whenDefined(tag))).then(() => {
            setPluginMap((prev) => {
                if (prev.has(def.id)) return prev;
                const next = new Map(prev);
                next.set(def.id, def);
                return next;
            });
        });
    }, []);

    const loadPlugin = useCallback(
        (entityType: string) => {
            if (loadingRef.current.has(entityType)) return;
            loadingRef.current.add(entityType);
            setLoadCounts((c) => ({ ...c, total: c.total + 1 }));

            loadWorkerPlugin(entityType)
                .then((result) => {
                    if (typeof result === 'object') {
                        addPlugin(result);
                        return;
                    }
                    if (result === 'data-only') {
                        // manifest に宣言されているがworkerなし。spawn して持ち回るだけのエンティティ
                        // (例: pen:stroke)。Worker を起動しないし、警告も出さない。
                        loadingRef.current.delete(entityType);
                        return;
                    }
                    // 'not-found': manifest が無い or 宣言されていない。古い YAML が削除済み
                    // プラグインを参照している可能性。警告だけ出して silently 無視する。
                    console.warn(
                        `[PluginRegistry] component "${entityType}" のプラグインが見つかりませんでした。スキップします。`,
                    );
                    loadingRef.current.delete(entityType);
                })
                .catch((err) => {
                    console.error(`[PluginRegistry] Failed to load plugin: ${entityType}`, err);
                    loadingRef.current.delete(entityType);
                })
                .finally(() => {
                    setLoadCounts((c) => ({ ...c, completed: c.completed + 1 }));
                });
        },
        [addPlugin],
    );

    // dependencies が登録されているからといって全 worker を一括起動しない。
    // シーン (initialEntities) に置かれたエンティティだけが EntityRenderer 経由で
    // loadPlugin される。singleton も同じく entity が無ければ起動しない。

    return (
        <PluginRegistryContext.Provider value={{ pluginMap, pendingPluginCount, loadPlugin }}>
            {children}
        </PluginRegistryContext.Provider>
    );
};

// ============================================
// Hook
// ============================================

export const usePluginRegistry = () => useContext(PluginRegistryContext);
