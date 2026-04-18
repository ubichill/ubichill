/**
 * usePluginFetch
 *
 * Worker の NET_FETCH コマンドを処理するフェッチハンドラを構築する。
 *
 * 責務:
 * - 相対 URL（/、./）→ fetchDirect（ドメインチェックをスキップ）
 * - pluginBase origin からの URL → fetchDirect（CDN アセット取得を許可）
 * - 外部 URL → createPluginFetchHandler（ドメインホワイトリストで検査）
 *
 * 許可ドメインの優先順位:
 *   1. plugin.json の fetchDomains（プラグイン発行者が制御）
 *   2. entity.data.fetchDomains（ワールド作成者が制御・外部バックエンド用）
 */

import { createPluginFetchHandler, fetchDirect } from '@ubichill/sandbox/host';
import type { FetchOptions, FetchResult, WorldEntity } from '@ubichill/shared';
import { useMemo } from 'react';
import type { WorkerPluginDefinition } from '../types';

export function usePluginFetch(
    definition: WorkerPluginDefinition,
    entity: WorldEntity,
): (url: string, options?: FetchOptions) => Promise<FetchResult> {
    const entityFetchDomains = useMemo(() => {
        const raw = (entity.data as Record<string, unknown>).fetchDomains;
        return Array.isArray(raw) ? (raw as string[]) : [];
    }, [entity.data]);

    return useMemo(() => {
        const mergedDomains = [...(definition.fetchDomains ?? []), ...entityFetchDomains];
        const externalHandler = createPluginFetchHandler(mergedDomains);
        const pluginBaseOrigin = (() => {
            try {
                return definition.pluginBase ? new URL(definition.pluginBase).origin : null;
            } catch {
                return null;
            }
        })();
        return (url: string, options?: FetchOptions): Promise<FetchResult> => {
            if (url.startsWith('/') || url.startsWith('./')) {
                return fetchDirect(url, options);
            }
            if (pluginBaseOrigin && url.startsWith(pluginBaseOrigin)) {
                return fetchDirect(url, options);
            }
            return externalHandler(url, options);
        };
    }, [definition.fetchDomains, definition.pluginBase, entityFetchDomains]);
}
