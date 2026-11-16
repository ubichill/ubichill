import { resolvePackage } from '@ubichill/loader';
import { type PackageDescriptor, PackageDescriptorSchema, parsePackageRef } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { HOST_MOD_SOURCE } from '@/lib/mods/modCdn';
import { browserSignatureVerifier } from '@/world/modSignature';
import { candidateFromPackage, type ModCandidate } from '../lib/modCatalog';

export type CatalogScope = 'local' | 'global';

interface CatalogPage {
    items: PackageDescriptor[];
    nextOffset: number | null;
}

async function fetchCatalog(scope: CatalogScope, query: string, offset: number, signal: AbortSignal) {
    const params = new URLSearchParams({ q: query, offset: String(offset), ...(scope === 'global' ? { scope } : {}) });
    const res = await fetch(`${API_BASE}/api/v1/mods?${params}`, { signal });
    if (!res.ok) throw new Error('mod の一覧を取得できませんでした');
    const data = (await res.json()) as { items?: unknown[]; nextOffset?: number | null };
    return {
        items: (data.items ?? []).flatMap((item) => {
            const parsed = PackageDescriptorSchema.safeParse(item);
            return parsed.success ? [parsed.data] : [];
        }),
        nextOffset: typeof data.nextOffset === 'number' ? data.nextOffset : null,
    } satisfies CatalogPage;
}

/**
 * このサーバー（local）・フォロー中のサーバー（global）の公開 mod。検索語が変わったら少し待ってから取り直す。
 * 作者参照（`@作者@サーバー/mod`）の検索語は名前検索に送らない（useResolvedPackage が直接解決する）。
 */
export function useModCatalog(scope: CatalogScope, query: string, enabled: boolean) {
    const q = query.trim();
    const isRef = parsePackageRef(q) !== null;
    const key = `${scope} ${q}`;
    const [state, setState] = useState<{ key: string; page: CatalogPage; loading: boolean; error: string }>({
        key: '',
        page: { items: [], nextOffset: null },
        loading: false,
        error: '',
    });

    useEffect(() => {
        if (!enabled || isRef) return;
        const abort = new AbortController();
        setState((prev) => ({ ...prev, key, loading: true, error: '' }));
        const timer = setTimeout(() => {
            fetchCatalog(scope, q, 0, abort.signal)
                .then((page) => setState({ key, page, loading: false, error: '' }))
                .catch((e: unknown) => {
                    if (abort.signal.aborted) return;
                    setState({
                        key,
                        page: { items: [], nextOffset: null },
                        loading: false,
                        error: e instanceof Error ? e.message : '取得できません',
                    });
                });
        }, 250);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [enabled, isRef, key, scope, q]);

    const loadMore = () => {
        const offset = state.page.nextOffset;
        if (offset === null || state.loading) return;
        setState((prev) => ({ ...prev, loading: true }));
        fetchCatalog(scope, q, offset, AbortSignal.timeout(10000))
            .then((page) =>
                setState((prev) =>
                    prev.key === key
                        ? {
                              key,
                              page: { items: [...prev.page.items, ...page.items], nextOffset: page.nextOffset },
                              loading: false,
                              error: '',
                          }
                        : prev,
                ),
            )
            .catch((e: unknown) =>
                setState((prev) =>
                    prev.key === key
                        ? { ...prev, loading: false, error: e instanceof Error ? e.message : '取得できません' }
                        : prev,
                ),
            );
    };

    const current = state.key === key && !isRef;
    return {
        items: current ? state.page.items : [],
        loading: enabled && !isRef && (!current || state.loading),
        error: current ? state.error : '',
        loadMore: current && state.page.nextOffset !== null ? loadMore : undefined,
    };
}

/** 検索語が作者参照・作品 URL なら、作者のサーバーで解決し、署名を確かめた版を 1 件の候補にする。 */
export function useResolvedPackage(query: string): {
    candidate?: ModCandidate;
    resolving: boolean;
    error: string;
} {
    const q = query.trim();
    const [state, setState] = useState<{ query: string; candidate?: ModCandidate; error: string }>({
        query: '',
        error: '',
    });
    const ref = parsePackageRef(q);
    const refKey = ref ? `${ref.author}/${ref.id}@${ref.version ?? ''}` : '';

    // biome-ignore lint/correctness/useExhaustiveDependencies: ref の同一性は refKey で決める
    useEffect(() => {
        if (!ref) return;
        const run = { cancelled: false };
        const timer = setTimeout(() => {
            resolvePackage(ref, { verify: browserSignatureVerifier(HOST_MOD_SOURCE.devHost) })
                .then((pkg) => {
                    if (!run.cancelled)
                        setState({ query: q, candidate: candidateFromPackage(pkg.descriptor), error: '' });
                })
                .catch((e: unknown) => {
                    if (!run.cancelled)
                        setState({ query: q, error: e instanceof Error ? e.message : '作者参照を解決できません' });
                });
        }, 300);
        return () => {
            run.cancelled = true;
            clearTimeout(timer);
        };
    }, [refKey]);

    if (!ref) return { resolving: false, error: '' };
    if (state.query !== q) return { resolving: true, error: '' };
    return { candidate: state.candidate, resolving: false, error: state.error };
}
