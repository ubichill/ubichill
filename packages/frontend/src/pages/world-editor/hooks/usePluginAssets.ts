import { useEffect, useState } from 'react';

export type AssetNode =
    | { kind: 'folder'; name: string; children: AssetNode[] }
    | { kind: 'file'; name: string; path: string; url: string };

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
        // cache: 'no-store' — manifest はビルド毎に workerUrl のハッシュや
        // assets リストが変わるため、ブラウザキャッシュを必ず迂回する。
        p = fetch(`${PLUGIN_BASE_URL}/${name}/v${version}/manifest.json`, { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<VersionedManifest>) : null))
            .catch(() => null);
        manifestCache.set(key, p);
    }
    return p;
}

/** flat path 一覧 (例: "templates/foo/bar.png") を tree に変換する純関数。 */
function buildAssetTree(paths: string[], base: string): AssetNode[] {
    type Dir = { kind: 'dir'; name: string; children: Map<string, Dir | FileLeaf> };
    type FileLeaf = { kind: 'file'; name: string; path: string };
    const root: Dir = { kind: 'dir', name: '', children: new Map() };

    for (const path of paths) {
        const segments = path.split('/').filter(Boolean);
        let cur: Dir = root;
        for (let i = 0; i < segments.length - 1; i += 1) {
            const seg = segments[i];
            const found = cur.children.get(seg);
            if (found?.kind === 'dir') {
                cur = found;
            } else {
                const next: Dir = { kind: 'dir', name: seg, children: new Map() };
                cur.children.set(seg, next);
                cur = next;
            }
        }
        const fileName = segments[segments.length - 1] ?? '';
        if (fileName) cur.children.set(fileName, { kind: 'file', name: fileName, path });
    }

    const toNode = (n: Dir | FileLeaf): AssetNode => {
        if (n.kind === 'file') return { kind: 'file', name: n.name, path: n.path, url: `${base}/${n.path}` };
        const children = [...n.children.values()].map(toNode);
        children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
        return { kind: 'folder', name: n.name, children };
    };

    return [...root.children.values()]
        .map(toNode)
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
}

/** plugin manifest の `assets` をフォルダツリーとして取得する。 */
export function usePluginAssets(pluginNames: string[]): {
    treesByPlugin: Map<string, AssetNode[]>;
    loading: boolean;
} {
    const [treesByPlugin, setTreesByPlugin] = useState<Map<string, AssetNode[]>>(new Map());
    const [loading, setLoading] = useState(false);

    const key = [...pluginNames].sort().join(',');

    // biome-ignore lint/correctness/useExhaustiveDependencies: key で deps を安定化
    useEffect(() => {
        if (pluginNames.length === 0) {
            setTreesByPlugin(new Map());
            return;
        }
        let cancelled = false;
        setLoading(true);
        Promise.all(
            pluginNames.map(async (name): Promise<[string, AssetNode[]]> => {
                const idx = await fetchIndex(name);
                if (!idx?.version) return [name, []];
                const manifest = await fetchManifest(name, idx.version);
                const base = `${PLUGIN_BASE_URL}/${name}/v${idx.version}`;
                return [name, buildAssetTree(manifest?.assets ?? [], base)];
            }),
        )
            .then((results) => {
                if (cancelled) return;
                setTreesByPlugin(new Map(results));
            })
            .catch(() => {
                if (cancelled) return;
                setTreesByPlugin(new Map());
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [key]);

    return { treesByPlugin, loading };
}
