'use client';

import type { WidgetDefinition } from '@ubichill/sdk/react';
import { useWorld } from '@ubichill/sdk/react';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PLUGIN_ID_TO_ENTITY_TYPE, PLUGIN_LOADERS } from './registry';

// ============================================
// Types
// ============================================

interface PluginRegistryContextType {
    pluginMap: Map<string, WidgetDefinition>;
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
    const [pluginMap, setPluginMap] = useState<Map<string, WidgetDefinition>>(new Map());
    // ロード済み（またはロード中）のエンティティタイプを追跡して重複ロードを防ぐ
    const loadingRef = useRef(new Set<string>());
    // register() 呼び出し済みの plugin id を追跡（StrictMode での二重呼び出し防止）
    const registeredRef = useRef(new Set<string>());

    const addPlugin = useCallback((def: WidgetDefinition) => {
        if (registeredRef.current.has(def.id)) return;
        registeredRef.current.add(def.id);

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
            const loader = PLUGIN_LOADERS[entityType];
            if (!loader) return;
            loadingRef.current.add(entityType);
            loader()
                .then(addPlugin)
                .catch((err) => {
                    console.error(`[PluginRegistry] Failed to load plugin: ${entityType}`, err);
                    // リトライできるようにフラグを解除
                    loadingRef.current.delete(entityType);
                });
        },
        [addPlugin],
    );

    // world:snapshot 受信後に activePlugins が更新されたタイミングでプラグインをロード
    useEffect(() => {
        for (const pluginId of activePlugins) {
            // plugin.json の id → エンティティタイプ に変換（一致しない場合はそのまま使用）
            const entityType = PLUGIN_ID_TO_ENTITY_TYPE[pluginId] ?? pluginId;
            loadPlugin(entityType);
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
