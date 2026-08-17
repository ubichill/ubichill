import type { WorldDefinition } from '@ubichill/shared';
import { useEffect, useState } from 'react';

/**
 * modの data フィールド宣言。インスペクタで「必ず表示する」フィールドの仕様。
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
    | { type: 'json'; default?: unknown; label?: string; help?: string }
    // 配列: 各要素を item スキーマで編集する。エディタは「行リスト＋追加/削除」で描画する。
    | { type: 'array'; default?: unknown[]; item: DataFields; label?: string; help?: string }
    // 他 Entity（単体）への参照。値は entityId。Hierarchy からの D&D で指定する。
    | { type: 'entityRef'; default?: string; label?: string; help?: string }
    // 他 Entity（複数）への参照。値は entityId の配列。
    | { type: 'entityRefArray'; default?: string[]; label?: string; help?: string };

export type DataFields = Record<string, DataFieldSpec>;

/**
 * modの manifest から取得できる、エディタで配置可能なエンティティ種別。
 */
export interface AvailableEntityKind {
    modName: string;
    kind: string; // "modName:entityKey"
    singleton?: boolean;
    canvasTargets?: string[];
    mediaTargets?: string[];
    /** デフォルトでサイズが必要そうかの推定（mediaTargets / canvasTargets を持つ場合は持たせる） */
    suggestSize: boolean;
    /** modが推奨する初期 transform（部分指定可） */
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
    /** Component アイコン URL (アセットブラウザ表示用)。manifest の `thumbnail` を versioned base で絶対化済み。 */
    thumbnailUrl?: string;
    /** View の描画方式。未指定ならロジックのみ（見た目なし）として扱う。 */
    renderKind?: 'jsx' | 'canvas' | 'threejs';
}

interface ModIndex {
    id: string;
    version: string;
}

interface VersionedManifestComponent {
    singleton?: boolean;
    canvasTargets?: string[];
    mediaTargets?: string[];
    defaultTransform?: AvailableEntityKind['defaultTransform'];
    dataFields?: DataFields;
    thumbnail?: string;
    renderKind?: 'jsx' | 'canvas' | 'threejs';
}

interface VersionedManifest {
    id: string;
    version: string;
    components?: Record<string, VersionedManifestComponent>;
}

const MOD_BASE_URL: string = (() => {
    const envUrl = (import.meta.env.VITE_MOD_CDN_URL as string | undefined) ?? '';
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/mods';
})();

const indexCache = new Map<string, Promise<ModIndex | null>>();
const manifestCache = new Map<string, Promise<VersionedManifest | null>>();

/** `source.type === 'url'` の mod は自身の `source.url` を base にする（グローバル `MOD_BASE_URL` はローカルmod専用）。 */
function resolveBase(dep: NonNullable<WorldDefinition['spec']['dependencies']>[number]): string {
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
        p = fetch(`${base}/${name}/v${version}/manifest.json`)
            .then((r) => (r.ok ? (r.json() as Promise<VersionedManifest>) : null))
            .catch(() => null);
        manifestCache.set(key, p);
    }
    return p;
}

/**
 * WorldDefinition の dependencies に登録された各modの manifest を読み、
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
                const base = resolveBase(dep);
                const idx = await fetchIndex(base, dep.name);
                if (!idx?.version) return [];
                const manifest = await fetchManifest(base, dep.name, idx.version);
                const components = manifest?.components ?? {};
                const versionedBase = `${base}/${dep.name}/v${idx.version}`;
                return Object.entries(components).map(([kind, meta]) => ({
                    modName: dep.name,
                    kind,
                    singleton: meta.singleton,
                    canvasTargets: meta.canvasTargets,
                    mediaTargets: meta.mediaTargets,
                    suggestSize: !!(meta.canvasTargets?.length || meta.mediaTargets?.length),
                    defaultTransform: meta.defaultTransform,
                    dataFields: meta.dataFields,
                    thumbnailUrl: meta.thumbnail ? `${versionedBase}/${meta.thumbnail}` : undefined,
                    renderKind: meta.renderKind,
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
