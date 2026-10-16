/**
 * useModFetch
 *
 * Worker の NETWORK_FETCH コマンドを処理するフェッチハンドラを構築する。
 *
 * 責務（普遍的なポリシー・特定modに依存しない）:
 * 1. 自分のアセット（modBase 配下・CDN でも可）→ 承認不要。
 * 2. 自分の公開名前空間 /mods/<modId>/（アプリ本体オリジン上。専用バックエンド含む）→ 承認不要。
 * 3. アプリ本体オリジンのそれ以外（コア /api、他modの領域）→ **禁止**。本体コア API・認証 cookie を保護する。
 * 4. 外部ドメイン → ドメイン単位の on-demand 承認（動画・音声と同じ許可を共有）。https 必須。
 * 5. リダイレクト先も同じ規則で認可し直す。外部オリジンには cookie を送らない。
 *
 * PermissionProvider が無い環境（エディタ Preview 等）では外部 fetch は拒否する。
 */

import { useMemo } from 'react';
import { createModFetch, type ModFetchHandler } from '../lib/modFetch';
import { modPermissionSubject, type WorkerModDefinition } from '../types';
import { useExternalUrlAuthorization } from './useExternalUrlAuthorization';

export function useModFetch(definition: WorkerModDefinition): ModFetchHandler {
    const authorizeUrl = useExternalUrlAuthorization(definition);
    const appOrigin = typeof window === 'undefined' ? undefined : window.location.origin;

    return useMemo(
        () =>
            createModFetch({
                // definition.id は "mod:component" 形式。承認は mod 単位なので ":" の前を使う。
                modId: definition.id.split(':')[0],
                permissionSubject: modPermissionSubject(definition),
                appOrigin,
                authorizeUrl,
            }),
        [definition, appOrigin, authorizeUrl],
    );
}
