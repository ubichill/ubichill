import type { WorldDefinition } from '@ubichill/shared';
import { useEffect, useState } from 'react';

export type AssetNode =
    | { kind: 'folder'; name: string; children: AssetNode[] }
    | { kind: 'file'; name: string; path: string; url: string };

type Dependency = NonNullable<WorldDefinition['spec']['dependencies']>[number];

interface ModIndex {
    id: string;
    version: string;
}

interface VersionedManifest {
    id: string;
    version: string;
    assets?: string[];
}

const MOD_BASE_URL: string = (() => {
    const envUrl = (import.meta.env.VITE_MOD_CDN_URL as string | undefined) ?? '';
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/mods';
})();

const indexCache = new Map<string, Promise<ModIndex | null>>();
const manifestCache = new Map<string, Promise<VersionedManifest | null>>();

/** `source.type === 'url'` の mod は自身の `source.url` を base にする（グローバル `MOD_BASE_URL` はローカルmod専用）。 */
function resolveBase(dep: Dependency): string {
    if (dep.source.type === 'url' && dep.source.url) return dep.source.url.replace(/\/$/, '');
    return MOD_BASE_URL;
}

function fetchIndex(base: string, name: string): Promise<ModIndex | null> {
    const key = `${base}/${name}`;
    let p = indexCache.get(key);
    if (!p) {
        p = fetch(`${base}/${name}/mod.json`, { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<ModIndex>) : null))
            .catch(() => null);
        indexCache.set(key, p);
    }
    return p;
}

function fetchManifest(base: string, name: string, version: string): Promise<VersionedManifest | null> {
    const key = `${base}/${name}@${version}`;
    let p = manifestCache.get(key);
    if (!p) {
        // cache: 'no-store' — manifest はビルド毎に workerUrl のハッシュや
        // assets リストが変わるため、ブラウザキャッシュを必ず迂回する。
        p = fetch(`${base}/${name}/v${version}/manifest.json`, { cache: 'no-store' })
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

/** mod manifest の `assets` をフォルダツリーとして取得する。 */
export function useModAssets(dependencies: Dependency[]): {
    treesByMod: Map<string, AssetNode[]>;
    loading: boolean;
} {
    const [treesByMod, setTreesByMod] = useState<Map<string, AssetNode[]>>(new Map());
    const [loading, setLoading] = useState(false);

    const key = dependencies
        .map((d) => d.name)
        .sort()
        .join(',');

    // biome-ignore lint/correctness/useExhaustiveDependencies: key で deps を安定化
    useEffect(() => {
        if (dependencies.length === 0) {
            setTreesByMod(new Map());
            return;
        }
        let cancelled = false;
        setLoading(true);
        Promise.all(
            dependencies.map(async (dep): Promise<[string, AssetNode[]]> => {
                const base0 = resolveBase(dep);
                const idx = await fetchIndex(base0, dep.name);
                if (!idx?.version) return [dep.name, []];
                const manifest = await fetchManifest(base0, dep.name, idx.version);
                const base = `${base0}/${dep.name}/v${idx.version}`;
                return [dep.name, buildAssetTree(manifest?.assets ?? [], base)];
            }),
        )
            .then((results) => {
                if (cancelled) return;
                setTreesByMod(new Map(results));
            })
            .catch(() => {
                if (cancelled) return;
                setTreesByMod(new Map());
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [key]);

    return { treesByMod, loading };
}
