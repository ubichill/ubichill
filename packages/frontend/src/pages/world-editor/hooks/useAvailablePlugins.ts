import type { WorldDefinition } from '@ubichill/shared';
import { useEffect, useState } from 'react';

type Dependency = NonNullable<WorldDefinition['spec']['dependencies']>[number];

/**
 * 利用可能プラグインの 1 エントリ。
 * - ローカル: `repositoryPath` を持つ → dependencies の source.type='repository' に変換
 * - リモート: `baseUrl` を持つ → dependencies の source.type='url' に変換
 */
export interface AvailablePlugin {
    id: string;
    name: string;
    version: string;
    kinds: string[];
    /** ローカルプラグインのみ */
    repositoryPath?: string;
    /** リモート（レジストリ） */
    baseUrl?: string;
    /** どこから来たか（UI 表示用） */
    sourceLabel: string;
}

interface RawIndexEntry {
    id: string;
    name?: string;
    version: string;
    kinds?: string[];
    repositoryPath?: string;
    baseUrl?: string;
}

const PLUGIN_BASE_URL: string = (() => {
    const envUrl = (import.meta.env.VITE_PLUGIN_CDN_URL as string | undefined) ?? '';
    if (envUrl) return envUrl.replace(/\/$/, '');
    return '/plugins';
})();

const cache = new Map<string, Promise<AvailablePlugin[]>>();

async function fetchRegistry(url: string, sourceLabel: string): Promise<AvailablePlugin[]> {
    let p = cache.get(url);
    if (!p) {
        p = (async () => {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as RawIndexEntry[];
            const baseUrl = url.slice(0, url.lastIndexOf('/'));
            return data.map((e) => ({
                id: e.id,
                name: e.name ?? e.id,
                version: e.version,
                kinds: e.kinds ?? [],
                repositoryPath: e.repositoryPath,
                // リモートエントリ baseUrl が無い場合は registry URL のディレクトリを採用
                baseUrl: e.baseUrl ?? (sourceLabel === 'local' ? undefined : baseUrl),
                sourceLabel,
            }));
        })().catch(() => [] as AvailablePlugin[]);
        cache.set(url, p);
    }
    return p;
}

/**
 * 利用可能プラグインの一覧を返す。
 * ローカル `${PLUGIN_BASE_URL}/index.json` と、追加されたレジストリ URL を全部統合する。
 * 同一 id がある場合は最初に登場したものを優先（ローカルを先にロードするため、ローカル優先）。
 */
export function useAvailablePlugins(registryUrls: string[]): {
    plugins: AvailablePlugin[];
    loading: boolean;
} {
    const [plugins, setPlugins] = useState<AvailablePlugin[]>([]);
    const [loading, setLoading] = useState(false);

    const urlsKey = registryUrls.join('|');

    // biome-ignore lint/correctness/useExhaustiveDependencies: urlsKey は registryUrls 配列の identity 安定化に使う。registryUrls は最新値が closure から取れる。
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const sources: Array<Promise<AvailablePlugin[]>> = [
            fetchRegistry(`${PLUGIN_BASE_URL}/index.json`, 'local'),
            ...registryUrls.map((u) => fetchRegistry(u, u)),
        ];
        Promise.all(sources)
            .then((results) => {
                if (cancelled) return;
                const seen = new Set<string>();
                const merged: AvailablePlugin[] = [];
                for (const list of results) {
                    for (const p of list) {
                        if (seen.has(p.id)) continue;
                        seen.add(p.id);
                        merged.push(p);
                    }
                }
                setPlugins(merged);
            })
            .catch(() => {
                if (cancelled) return;
                setPlugins([]);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // urlsKey で再評価する（registryUrls 配列の identity 安定化のため）
    }, [urlsKey]);

    return { plugins, loading };
}

/**
 * AvailablePlugin から WorldDefinition の dependencies エントリを構築する。
 */
export function pluginToDependency(p: AvailablePlugin): Dependency {
    if (p.repositoryPath) {
        return { name: p.id, source: { type: 'repository', path: p.repositoryPath } };
    }
    if (p.baseUrl) {
        return { name: p.id, source: { type: 'url', url: p.baseUrl, version: p.version } };
    }
    // フォールバック: name のみで repository
    return { name: p.id, source: { type: 'repository', path: `plugins/${p.id}` } };
}
