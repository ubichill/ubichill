import type { WidgetDefinition, WorkerPluginDefinition } from '@ubichill/sdk/react';
import { isWorkerPlugin } from '@ubichill/sdk/react';
import type React from 'react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { attachAvatarCursorHostBridge } from './avatarCursorHostBridge';
import { attachAvatarHostBridge } from './avatarHostBridge';
import { PLUGIN_LOADERS } from './registry';

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
 * バージョン付きマニフェスト（/plugins/<name>/v<ver>/plugin.json）のエンティティ定義。
 * ビルド時のみ必要な src フィールドは含まない。
 * workerUrl はバージョンディレクトリからの相対パス（例: "./cursor/index.js"）。
 */
interface WorkerMetaObject {
    workerUrl: string;
    capabilities?: string[];
    singleton?: boolean;
    canvasTargets?: string[];
    watchEntityTypes?: string[];
    mediaTargets?: string[];
    fetchDomains?: string[];
}

/** バージョン付きマニフェスト全体 */
interface VersionedPluginJson {
    id: string;
    name?: string;
    version: string;
    entities?: Record<string, WorkerMetaObject>;
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
            fetch(`${PLUGIN_BASE_URL}/${pluginName}/v${version}/manifest.json`)
                .then((r) => (r.ok ? (r.json() as Promise<VersionedPluginJson>) : null))
                .catch(() => null),
        );
    }
    return versionedManifestCache.get(key) ?? Promise.resolve(null);
}

/**
 * エンティティタイプ (`pluginName:entityKey`) から WorkerPluginDefinition を構築する。
 * 該当するプラグインがない or workerUrl が無いデータ専用エンティティの場合は null。
 */
async function loadWorkerPlugin(entityType: string): Promise<WorkerPluginDefinition | null> {
    const colonIdx = entityType.indexOf(':');
    if (colonIdx === -1) return null; // entityType は必ずコロン形式

    const pluginName = entityType.slice(0, colonIdx);
    const index = await fetchPluginIndex(pluginName);
    if (!index?.version) return null;

    const manifest = await fetchVersionedManifest(pluginName, index.version);
    const entry = manifest?.entities?.[entityType];
    if (!entry || !entry.workerUrl) return null;

    const versionedBase = `${PLUGIN_BASE_URL}/${pluginName}/v${index.version}`;
    const workerUrl = `${versionedBase}/${entry.workerUrl.replace(/^\.\//, '')}`;

    let workerCode: string;
    try {
        const res = await fetch(workerUrl);
        if (!res.ok) return null;
        workerCode = await res.text();
    } catch {
        return null;
    }

    const def: WorkerPluginDefinition = {
        id: entityType,
        name: `${manifest?.name ?? pluginName} - ${entityType.slice(colonIdx + 1)}`,
        workerCode,
        capabilities: entry.capabilities,
        singleton: entry.singleton,
        canvasTargets: entry.canvasTargets,
        watchEntityTypes: entry.watchEntityTypes,
        mediaTargets: entry.mediaTargets,
        fetchDomains: entry.fetchDomains,
        pluginBase: versionedBase,
    };
    return attachAvatarHostBridge(attachAvatarCursorHostBridge(def));
}

// ============================================
// Types
// ============================================

export type AnyPluginDefinition = WidgetDefinition | WorkerPluginDefinition;

interface PluginRegistryContextType {
    pluginMap: Map<string, AnyPluginDefinition>;
    /** エンティティタイプを指定してプラグインを動的ロードする（未ロードの場合のみ実行） */
    loadPlugin: (entityType: string) => void;
}

// ============================================
// Context
// ============================================

const PluginRegistryContext = createContext<PluginRegistryContextType>({
    pluginMap: new Map(),
    loadPlugin: () => {},
});

// ============================================
// Provider
// ============================================

export const PluginRegistryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [pluginMap, setPluginMap] = useState<Map<string, AnyPluginDefinition>>(new Map());
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

            loadWorkerPlugin(entityType)
                .then((def) => {
                    if (def) {
                        addPlugin(def);
                        return;
                    }
                    // フォールバック: 静的 PLUGIN_LOADERS（CE ベースの非 Worker プラグイン）
                    const loader = PLUGIN_LOADERS[entityType];
                    if (!loader) {
                        loadingRef.current.delete(entityType);
                        return;
                    }
                    return loader()
                        .then(addPlugin)
                        .catch((err: unknown) => {
                            console.error(`[PluginRegistry] Failed to load plugin: ${entityType}`, err);
                            loadingRef.current.delete(entityType);
                        });
                })
                .catch((err) => {
                    console.error(`[PluginRegistry] Failed to load plugin: ${entityType}`, err);
                    loadingRef.current.delete(entityType);
                });
        },
        [addPlugin],
    );

    // dependencies が登録されているからといって全 worker を一括起動しない。
    // シーン (initialEntities) に置かれたエンティティだけが EntityRenderer 経由で
    // loadPlugin される。singleton も同じく entity が無ければ起動しない。

    return (
        <PluginRegistryContext.Provider value={{ pluginMap, loadPlugin }}>{children}</PluginRegistryContext.Provider>
    );
};

// ============================================
// Hook
// ============================================

export const usePluginRegistry = () => useContext(PluginRegistryContext);
