import type { WidgetDefinition, WorkerPluginDefinition } from '@ubichill/sdk/react';
import { isWorkerPlugin, useWorld } from '@ubichill/sdk/react';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PLUGIN_LOADERS } from './registry';

// ============================================
// plugin.json 自動ローダー
// ============================================

interface WorkerMetaObject {
    src: string;
    capabilities?: string[];
    singleton?: boolean;
    canvasTargets?: string[];
    watchEntityTypes?: string[];
    mediaTargets?: string[];
    fetchDomains?: string[];
}

interface PluginJson {
    id: string;
    name?: string;
    version: string;
    entities?: Record<string, string | WorkerMetaObject>;
}

/**
 * プラグインのベースURL。
 * VITE_PLUGIN_CDN_URL が設定されている場合はそちらを使う（外部CDN / GitHub Pages）。
 * 未設定の場合は自ホストの /plugins/ に相対パスでアクセスする。
 *
 * 例: VITE_PLUGIN_CDN_URL=https://myorg.github.io/ubichill-plugins
 *     → https://myorg.github.io/ubichill-plugins/pen/plugin.json
 */
const PLUGIN_BASE_URL: string = (() => {
    const envUrl = import.meta.env.VITE_PLUGIN_CDN_URL as string | undefined;
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/plugins';
})();

/** プラグイン名 → plugin.json のキャッシュ（Promise を保持して重複フェッチ防止） */
const pluginJsonCache = new Map<string, Promise<PluginJson | null>>();

function fetchPluginJson(pluginName: string): Promise<PluginJson | null> {
    if (!pluginJsonCache.has(pluginName)) {
        pluginJsonCache.set(
            pluginName,
            fetch(`${PLUGIN_BASE_URL}/${pluginName}/plugin.json`)
                .then((r) => (r.ok ? (r.json() as Promise<PluginJson>) : null))
                .catch(() => null),
        );
    }
    const cached = pluginJsonCache.get(pluginName);
    if (!cached) {
        return Promise.resolve(null);
    }
    return cached;
}

/**
 * plugin.json のエンティティ定義から WorkerPluginDefinition を構築する。
 * entityType は `pluginName:entityKey` 形式（例: "avatar:cursor"）。
 * entities キーがそのまま entityType と一致する。
 */
async function autoLoadWorkerPlugins(entityType: string): Promise<WorkerPluginDefinition[]> {
    const colonIdx = entityType.indexOf(':');
    if (colonIdx === -1) return [];

    const pluginName = entityType.slice(0, colonIdx);
    const entityKey = entityType.slice(colonIdx + 1);

    const pluginJson = await fetchPluginJson(pluginName);
    if (!pluginJson?.entities) return [];

    const entry = pluginJson.entities[entityType];
    if (!entry) return [];

    const meta: Partial<WorkerMetaObject> = typeof entry === 'string' ? {} : entry;
    const workerUrl = `${PLUGIN_BASE_URL}/${pluginName}/v${pluginJson.version}/${entityKey}/index.js`;

    let workerCode: string;
    try {
        const res = await fetch(workerUrl);
        if (!res.ok) return [];
        workerCode = await res.text();
    } catch {
        return [];
    }

    return [
        {
            id: entityType,
            name: `${pluginJson.name ?? pluginName} - ${entityKey}`,
            workerCode,
            capabilities: meta.capabilities,
            singleton: meta.singleton,
            canvasTargets: meta.canvasTargets,
            watchEntityTypes: meta.watchEntityTypes,
            mediaTargets: meta.mediaTargets,
            fetchDomains: meta.fetchDomains,
        },
    ];
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
    const { activePlugins } = useWorld();
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

        // 全タグ（entity + singleton）の define が完了してから pluginMap に追加する。
        // これにより EntityCEBridge / SingletonMount が createElement した時点で
        // 必ず CE クラスが存在し、ubiCtx / instanceCtx setter → onUpdate が動作する。
        const allTags = [def.elementTag, ...(def.singletonTag ? [def.singletonTag] : []), ...(def.singletonTags ?? [])];
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

            // 1. plugin.json 自動ローダー
            autoLoadWorkerPlugins(entityType)
                .then((defs) => {
                    if (defs.length > 0) {
                        defs.forEach((def) => {
                            addPlugin(def);
                        });
                        return;
                    }
                    // 2. フォールバック: 静的 PLUGIN_LOADERS（video-player 等の非 Worker プラグイン）
                    const loader = PLUGIN_LOADERS[entityType];
                    if (!loader) {
                        loadingRef.current.delete(entityType);
                        return;
                    }
                    return loader()
                        .then(addPlugin)
                        .catch((err: unknown) => {
                            console.error(`[PluginRegistry] Failed to load plugin: ${entityType}`, err);
                            // 失敗時に loadingRef を解放してリトライを許可する
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

    // world:snapshot 受信後に activePlugins が更新されたタイミングでシングルトンプラグインをロード
    useEffect(() => {
        for (const pluginId of activePlugins) {
            loadPlugin(pluginId);
        }
    }, [activePlugins, loadPlugin]);

    return (
        <PluginRegistryContext.Provider value={{ pluginMap, loadPlugin }}>{children}</PluginRegistryContext.Provider>
    );
};

// ============================================
// Hook
// ============================================

export const usePluginRegistry = () => useContext(PluginRegistryContext);
