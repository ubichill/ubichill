/**
 * useModFetch
 *
 * Worker の NETWORK_FETCH コマンドを処理するフェッチハンドラを構築する。
 *
 * 責務（普遍的なポリシー・特定modに依存しない）:
 * 1. 自分のアセット（modBase 配下・CDN でも可）→ fetchDirect（承認不要）。
 * 2. 自分の公開名前空間 /mods/<modId>/（アプリ本体オリジン上。専用バックエンド含む）
 *    → fetchDirect（承認不要）。全mod共通の配信規約なので普遍的。
 * 3. アプリ本体オリジンのそれ以外（コア /api、他modの領域）→ **禁止**。
 *    本体コア API・認証 cookie を保護する。
 * 4. 外部ドメイン → ドメイン単位の on-demand 承認（PermissionProvider.authorizeFetchDomain）。
 *    ユーザーが許可したドメインのみ通す。開発者はドメインを宣言しない。https 必須は維持。
 *
 * PermissionProvider が無い環境（エディタ Preview 等）では外部 fetch は拒否する。
 */

import { fetchDirect, reportDiagnostic, resolveModAssetUrl, resolveModNamespaceUrl } from '@ubichill/sandbox';
import { type FetchOptions, type FetchResult, UbiErrorCode } from '@ubichill/shared';
import { useMemo } from 'react';
import { useUbiPermissions } from '../components/PermissionContext';
import type { WorkerModDefinition } from '../types';

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

export function useModFetch(
    definition: WorkerModDefinition,
): (url: string, options?: FetchOptions) => Promise<FetchResult> {
    const permissions = useUbiPermissions();
    const authorizeFetchDomain = permissions?.authorizeFetchDomain;

    return useMemo(() => {
        // definition.id は "mod:component" 形式。名前空間・fetch 承認はmod単位なので
        // ":" の前（mod名）を使う。例: "video-player:search" → "video-player"。
        const modId = definition.id.split(':')[0];
        const modBase = definition.modBase;

        const appOrigin = typeof window === 'undefined' ? undefined : window.location.origin;

        // 拒否は必ず診断に出す（console.warn 既定 + UI ハンドラでトースト化）。沈黙させない。
        // domain を渡すと拒否トーストに「許可」ボタン（クリックでそのドメインを許可）が付く。
        const deny = (code: UbiErrorCode, message: string, domain?: string): FetchResult => {
            reportDiagnostic({
                level: 'warn',
                modId,
                code,
                message,
                ...(domain ? { retry: { modId, domain } } : {}),
            });
            return forbidden(code, message);
        };

        return async (url: string, options?: FetchOptions): Promise<FetchResult> => {
            // 1. 自分のアセット（modBase 配下）/ 2. 自分の公開名前空間 /mods/<id>/ は承認不要。
            const ownUrl = resolveModAssetUrl(url, modBase) ?? resolveModNamespaceUrl(url, modId, appOrigin);
            if (ownUrl !== null) {
                return fetchDirect(ownUrl, options);
            }

            // URL を解決（相対はアプリ本体オリジン基準）。
            let resolved: URL;
            try {
                resolved = new URL(url, appOrigin);
            } catch {
                return deny(UbiErrorCode.FETCH_INVALID_URL, `URL として不正です: ${url}`);
            }

            // 3. アプリ本体オリジンのうち自分の領域以外（コア /api・他mod）は禁止。
            //    本体コア API・認証 cookie を保護する。
            if (appOrigin && resolved.origin === appOrigin) {
                return deny(
                    UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
                    'アプリ本体のコア API へのアクセスは許可されていません',
                );
            }

            // 4. 外部ドメイン: ドメイン単位でユーザー承認を得る。
            const hostname = resolved.hostname;
            if (!authorizeFetchDomain) {
                // 権限コンテキスト不在（Preview 等）では外部 fetch を許可しない。
                return deny(UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED, '権限コンテキストが無いため外部通信できません');
            }

            const allowed = await authorizeFetchDomain(modId, hostname);
            if (!allowed) {
                return deny(
                    UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
                    `ユーザーが ${hostname} への通信を許可していません`,
                    hostname,
                );
            }

            // 承認済み: 承認したホスト名そのものに完全一致・https 必須で実行（suffix マッチはしない）。
            if (resolved.protocol !== 'https:') {
                return deny(
                    UbiErrorCode.FETCH_HTTPS_REQUIRED,
                    `https 以外は許可されていません: ${resolved.protocol}//`,
                );
            }
            return fetchDirect(resolved.href, options);
        };
    }, [definition.id, definition.modBase, authorizeFetchDomain]);
}
