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
 * 4. 外部ドメイン → ドメイン単位の on-demand 承認（動画・音声と同じ許可を共有）。
 *    ユーザーが許可したドメインのみ通す。開発者はドメインを宣言しない。https 必須は維持。
 *
 * PermissionProvider が無い環境（エディタ Preview 等）では外部 fetch は拒否する。
 */

import { fetchDirect, reportDiagnostic } from '@ubichill/sandbox';
import type { FetchOptions, FetchResult, UbiErrorCode } from '@ubichill/shared';
import { useMemo } from 'react';
import type { WorkerModDefinition } from '../types';
import { useExternalUrlAuthorization } from './useExternalUrlAuthorization';

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
    const authorizeUrl = useExternalUrlAuthorization(definition);

    return useMemo(() => {
        // definition.id は "mod:component" 形式。名前空間・fetch 承認はmod単位なので
        // ":" の前（mod名）を使う。例: "video-player:search" → "video-player"。
        const modId = definition.id.split(':')[0];
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
            const access = await authorizeUrl(url);
            if (!access.allowed) return deny(access.code, access.message, access.domain);
            return fetchDirect(access.url, options);
        };
    }, [definition.id, authorizeUrl]);
}
