import { useEffect, useState } from 'react';
import { MOD_CDN_URL } from '@/lib/mods/modCdn';

/** index.json が持つバージョン履歴の1件。 */
export interface ModVersionSummary {
    version: string;
    components: string[];
}

/**
 * 利用可能modの 1 エントリ。
 * - 本体の mods（`sourceLabel === 'local'`）: 依存の source.url なし
 * - レジストリ: `baseUrl` を持つ → 依存の source.url
 */
export interface AvailableMod {
    id: string;
    name: string;
    version: string;
    /** Component 型 (`modId:componentName`) 一覧 */
    components: string[];
    /** 過去にビルドされた全バージョン（新しい順）。旧形式の index.json では undefined。 */
    versions?: ModVersionSummary[];
    /** リモート（レジストリ） */
    baseUrl?: string;
    /** どこから来たか（UI 表示用。'local' ならこのインスタンスの mods-dir） */
    sourceLabel: string;
}

interface RawIndexEntry {
    id: string;
    name?: string;
    version: string;
    components?: string[];
    versions?: ModVersionSummary[];
    baseUrl?: string;
}

const cache = new Map<string, Promise<AvailableMod[]>>();

async function fetchRegistry(url: string, sourceLabel: string): Promise<AvailableMod[]> {
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
                components: e.components ?? [],
                versions: e.versions,
                // リモートエントリ baseUrl が無い場合は registry URL のディレクトリを採用
                baseUrl: e.baseUrl ?? (sourceLabel === 'local' ? undefined : baseUrl),
                sourceLabel,
            }));
        })().catch(() => [] as AvailableMod[]);
        cache.set(url, p);
    }
    return p;
}

/**
 * 本体の `${MOD_CDN_URL}/index.json` と、追加したレジストリの mod。取得元ごとに分けて返す
 * （同じ ID でも取得元が違えば別の mod。どちらを入れるかは利用者が選ぶ）。取れなかった取得元は空。
 */
export function useAvailableMods(registryUrls: string[]): {
    host: AvailableMod[];
    registries: AvailableMod[];
    loading: boolean;
} {
    const [lists, setLists] = useState<{ host: AvailableMod[]; registries: AvailableMod[] }>({
        host: [],
        registries: [],
    });
    const [loading, setLoading] = useState(false);
    const urlsKey = registryUrls.join('|');

    // biome-ignore lint/correctness/useExhaustiveDependencies: urlsKey は registryUrls 配列の identity 安定化に使う
    useEffect(() => {
        const run = { cancelled: false };
        setLoading(true);
        Promise.all([
            fetchRegistry(`${MOD_CDN_URL}/index.json`, 'local'),
            Promise.all(registryUrls.map((url) => fetchRegistry(url, url))),
        ])
            .then(([host, registries]) => {
                if (run.cancelled) return;
                // 2 つのレジストリが同じ mod を載せている場合は 1 件にする
                const all = registries.flat();
                const unique = all.filter(
                    (mod, index) => all.findIndex((m) => m.id === mod.id && m.baseUrl === mod.baseUrl) === index,
                );
                setLists({ host, registries: unique });
            })
            .finally(() => {
                if (!run.cancelled) setLoading(false);
            });
        return () => {
            run.cancelled = true;
        };
    }, [urlsKey]);

    return { ...lists, loading };
}
