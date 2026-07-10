/**
 * usePluginFetch
 *
 * Worker の NET_FETCH コマンドを処理するフェッチハンドラを構築する。
 *
 * 責務:
 * - プラグイン自身のアセット領域（pluginBase 配下）→ fetchDirect。相対 URL は
 *   pluginBase を基準に解決し、配下に収まるもののみ許可（resolvePluginAssetUrl）。
 * - それ以外（外部 URL / プラグイン領域外の絶対・相対 URL）→ createPluginFetchHandler
 *   でドメイン allowlist を検査。
 *
 * 重要: 以前は先頭 `/` の相対 URL を無検査で fetchDirect に流していたため、
 * `Ubi.fetch('/api/...')` でホスト内部 API を credential 付きで叩ける抜け道があった。
 * pluginBase 配下への限定でこれを塞ぐ（領域外は allowlist 検査に回るため素通りしない）。
 *
 * 許可ドメインの優先順位:
 *   1. plugin.json の fetchDomains（プラグイン発行者が制御）
 *   2. entity.data.fetchDomains（ワールド作成者が制御・外部バックエンド用）
 */

import { createPluginFetchHandler, fetchDirect, resolvePluginAssetUrl } from '@ubichill/sandbox';
import type { ComponentInstance, FetchOptions, FetchResult } from '@ubichill/shared';
import { useMemo } from 'react';
import type { WorkerPluginDefinition } from '../types';

export function usePluginFetch(
    definition: WorkerPluginDefinition,
    entity: ComponentInstance,
): (url: string, options?: FetchOptions) => Promise<FetchResult> {
    const entityFetchDomains = useMemo(() => {
        const raw = (entity.data as Record<string, unknown>).fetchDomains;
        return Array.isArray(raw) ? (raw as string[]) : [];
    }, [entity.data]);

    return useMemo(() => {
        const mergedDomains = [...(definition.fetchDomains ?? []), ...entityFetchDomains];
        const externalHandler = createPluginFetchHandler(mergedDomains);
        const pluginBase = definition.pluginBase;
        return (url: string, options?: FetchOptions): Promise<FetchResult> => {
            const assetUrl = resolvePluginAssetUrl(url, pluginBase);
            if (assetUrl !== null) {
                return fetchDirect(assetUrl, options);
            }
            return externalHandler(url, options);
        };
    }, [definition.fetchDomains, definition.pluginBase, entityFetchDomains]);
}
