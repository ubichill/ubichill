import type { WorldDefinition } from '@ubichill/shared';
import { useEffect, useState } from 'react';

/**
 * プラグインの data フィールド宣言。インスペクタで「必ず表示する」フィールドの仕様。
 */
export type DataFieldSpec =
    | { type: 'string'; default?: string; multiline?: boolean; placeholder?: string; label?: string; help?: string }
    | {
          type: 'number';
          default?: number;
          min?: number;
          max?: number;
          step?: number;
          label?: string;
          help?: string;
      }
    | { type: 'boolean'; default?: boolean; label?: string; help?: string }
    | { type: 'color'; default?: string; label?: string; help?: string }
    | { type: 'url'; default?: string; placeholder?: string; label?: string; help?: string }
    | { type: 'enum'; default?: string; options: string[]; label?: string; help?: string }
    | { type: 'json'; default?: unknown; label?: string; help?: string };

export type DataFields = Record<string, DataFieldSpec>;

/**
 * プラグインの manifest から取得できる、エディタで配置可能なエンティティ種別。
 */
export interface AvailableEntityKind {
    pluginName: string;
    kind: string; // "pluginName:entityKey"
    singleton?: boolean;
    canvasTargets?: string[];
    mediaTargets?: string[];
    /** デフォルトでサイズが必要そうかの推定（mediaTargets / canvasTargets を持つ場合は持たせる） */
    suggestSize: boolean;
    /** プラグインが推奨する初期 transform（部分指定可） */
    defaultTransform?: Partial<{
        x: number;
        y: number;
        z: number;
        w: number;
        h: number;
        scale: number;
        rotation: number;
    }>;
    /** インスペクタで必ず表示する data フィールドの宣言 */
    dataFields?: DataFields;
}

interface PluginIndex {
    id: string;
    version: string;
}

interface VersionedManifestEntity {
    singleton?: boolean;
    canvasTargets?: string[];
    mediaTargets?: string[];
    defaultTransform?: AvailableEntityKind['defaultTransform'];
    dataFields?: DataFields;
}

interface VersionedManifest {
    id: string;
    version: string;
    entities?: Record<string, VersionedManifestEntity>;
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

/**
 * WorldDefinition の dependencies に登録された各プラグインの manifest を読み、
 * 配置可能な entity kind 一覧を返す。
 */
export function useAvailableEntityKinds(definition: WorldDefinition | null): {
    kinds: AvailableEntityKind[];
    loading: boolean;
} {
    const [kinds, setKinds] = useState<AvailableEntityKind[]>([]);
    const [loading, setLoading] = useState(false);

    const depKey = (definition?.spec.dependencies ?? [])
        .map((d) => d.name)
        .sort()
        .join(',');

    // biome-ignore lint/correctness/useExhaustiveDependencies: depKey は dependencies 配列の identity 安定化に使う。definition は最新値が closure から取れる。
    useEffect(() => {
        const deps = definition?.spec.dependencies ?? [];
        if (deps.length === 0) {
            setKinds([]);
            return;
        }
        let cancelled = false;
        setLoading(true);
        Promise.all(
            deps.map(async (dep) => {
                const idx = await fetchIndex(dep.name);
                if (!idx?.version) return [];
                const manifest = await fetchManifest(dep.name, idx.version);
                const entities = manifest?.entities ?? {};
                return Object.entries(entities).map(([kind, meta]) => ({
                    pluginName: dep.name,
                    kind,
                    singleton: meta.singleton,
                    canvasTargets: meta.canvasTargets,
                    mediaTargets: meta.mediaTargets,
                    suggestSize: !!(meta.canvasTargets?.length || meta.mediaTargets?.length),
                    defaultTransform: meta.defaultTransform,
                    dataFields: meta.dataFields,
                }));
            }),
        )
            .then((results) => {
                if (cancelled) return;
                setKinds(results.flat());
            })
            .catch(() => {
                if (cancelled) return;
                setKinds([]);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [depKey]);

    return { kinds, loading };
}
