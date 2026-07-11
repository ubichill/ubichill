/**
 * usePluginFetch
 *
 * Worker の NET_FETCH コマンドを処理するフェッチハンドラを構築する。
 *
 * 責務:
 * - プラグイン自身のアセット領域（pluginBase 配下）→ fetchDirect（承認不要）。
 * - 外部 URL → ドメイン単位の on-demand 承認（PermissionProvider.authorizeFetchDomain）。
 *   ユーザーが許可したドメインのみ通す。プラグイン開発者はドメインを宣言しない
 *   （旧 plugin.json fetchDomains は廃止）。https 必須は維持。
 *
 * PermissionProvider が無い環境（エディタ Preview 等）では外部 fetch は拒否する。
 */

import { createPluginFetchHandler, fetchDirect, resolvePluginAssetUrl } from '@ubichill/sandbox';
import { type FetchOptions, type FetchResult, UbiErrorCode } from '@ubichill/shared';
import { useMemo } from 'react';
import { useUbiPermissions } from '../components/PermissionContext';
import type { WorkerPluginDefinition } from '../types';

/** Host が合成する拒否レスポンス。 */
function forbidden(code: UbiErrorCode, message: string): FetchResult {
    return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        body: JSON.stringify({ error: { code, message } }),
    };
}

export function usePluginFetch(
    definition: WorkerPluginDefinition,
): (url: string, options?: FetchOptions) => Promise<FetchResult> {
    const permissions = useUbiPermissions();
    const authorizeFetchDomain = permissions?.authorizeFetchDomain;

    return useMemo(() => {
        const pluginId = definition.id;
        const pluginBase = definition.pluginBase;

        return async (url: string, options?: FetchOptions): Promise<FetchResult> => {
            // 1. プラグイン自身のアセット（pluginBase 配下）は承認不要。
            const assetUrl = resolvePluginAssetUrl(url, pluginBase);
            if (assetUrl !== null) {
                return fetchDirect(assetUrl, options);
            }

            // 2. 外部 URL: ドメイン単位でユーザー承認を得る。
            let hostname: string;
            try {
                hostname = new URL(url).hostname;
            } catch {
                return forbidden(UbiErrorCode.FETCH_INVALID_URL, `URL として不正です: ${url}`);
            }

            if (!authorizeFetchDomain) {
                // 権限コンテキスト不在（Preview 等）では外部 fetch を許可しない。
                return forbidden(UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED, '権限コンテキストが無いため外部通信できません');
            }

            const allowed = await authorizeFetchDomain(pluginId, hostname);
            if (!allowed) {
                return forbidden(
                    UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
                    `ユーザーが ${hostname} への通信を許可していません`,
                );
            }

            // 3. 承認済みドメインに限定して実行（https 必須・ホスト名一致は共通ロジックで検査）。
            return createPluginFetchHandler([hostname])(url, options);
        };
    }, [definition.id, definition.pluginBase, authorizeFetchDomain]);
}
