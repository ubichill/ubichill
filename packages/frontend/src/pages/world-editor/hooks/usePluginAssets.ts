import { useEffect, useState } from 'react';

export interface PluginAssetFile {
    /** プラグインのバージョン付きベースからの相対パス (例: "templates/manifest.json") */
    path: string;
    /** ブラウザから直接 fetch / img.src で参照できる絶対 URL */
    url: string;
}

interface PluginIndex {
    id: string;
    version: string;
}

interface VersionedManifest {
    id: string;
    version: string;
    assets?: string[];
}

const PLUGIN_BASE_URL: string = (() => {
    const envUrl = (import.meta.env.VITE_PLUGIN_CDN_URL as string | undefined) ?? '';
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/plugins';
})();

const indexCache = new Map<string, Promise<PluginIndex | null>>();
const manifestCache = new Map<string, Promise<VersionedManifest | null>>();

function fetchIndex(name: string): Promise<PluginIndex | null> {
    let p = indexCache.get(name);
    if (!p) {
        p = fetch(`${PLUGIN_BASE_URL}/${name}/plugin.json`, { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<PluginIndex>) : null))
            .catch(() => null);
        indexCache.set(name, p);
    }
    return p;
}

function fetchManifest(name: string, version: string): Promise<VersionedManifest | null> {
    const key = `${name}@${version}`;
    let p = manifestCache.get(key);
    if (!p) {
        p = fetch(`${PLUGIN_BASE_URL}/${name}/v${version}/manifest.json`)
            .then((r) => (r.ok ? (r.json() as Promise<VersionedManifest>) : null))
            .catch(() => null);
        manifestCache.set(key, p);
    }
    return p;
}

/** plugin manifest の `assets` フィールドからアセットファイル一覧を取得する。 */
export function usePluginAssets(pluginNames: string[]): {
    assetsByPlugin: Map<string, PluginAssetFile[]>;
    loading: boolean;
} {
    const [assetsByPlugin, setAssetsByPlugin] = useState<Map<string, PluginAssetFile[]>>(new Map());
    const [loading, setLoading] = useState(false);

    const key = [...pluginNames].sort().join(',');

    // biome-ignore lint/correctness/useExhaustiveDependencies: key で deps を安定化
    useEffect(() => {
        if (pluginNames.length === 0) {
            setAssetsByPlugin(new Map());
            return;
        }
        let cancelled = false;
        setLoading(true);
        Promise.all(
            pluginNames.map(async (name): Promise<[string, PluginAssetFile[]]> => {
                const idx = await fetchIndex(name);
                if (!idx?.version) return [name, []];
                const manifest = await fetchManifest(name, idx.version);
                const base = `${PLUGIN_BASE_URL}/${name}/v${idx.version}`;
                const files = (manifest?.assets ?? []).map((path) => ({ path, url: `${base}/${path}` }));
                return [name, files];
            }),
        )
            .then((results) => {
                if (cancelled) return;
                setAssetsByPlugin(new Map(results));
            })
            .catch(() => {
                if (cancelled) return;
                setAssetsByPlugin(new Map());
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [key]);

    return { assetsByPlugin, loading };
}
