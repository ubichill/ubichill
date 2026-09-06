import { resolveModAssetUrl, resolveModNamespaceUrl } from '@ubichill/sandbox';
import { UbiErrorCode } from '@ubichill/shared';
import { useMemo } from 'react';
import { useUbiPermissions } from '../components/PermissionContext';
import type { WorkerModDefinition } from '../types';

export type ExternalUrlAccess =
    | { allowed: true; url: string }
    | { allowed: false; code: UbiErrorCode; message: string; domain?: string };

export interface ExternalUrlAuthorizationOptions {
    url: string;
    modBase: string | undefined;
    modId: string;
    appOrigin: string | undefined;
    authorizeExternalDomain?: (modId: string, domain: string) => boolean | Promise<boolean>;
}

/**
 * mod が要求した URL を、通信手段に関係なく同じ規則で認可する。
 * Ubi.fetch と Ubi.media.load はこの関数を共有し、ドメイン許可も共有する。
 */
export async function authorizeExternalUrl({
    url,
    modBase,
    modId,
    appOrigin,
    authorizeExternalDomain,
}: ExternalUrlAuthorizationOptions): Promise<ExternalUrlAccess> {
    const ownUrl = resolveModAssetUrl(url, modBase) ?? resolveModNamespaceUrl(url, modId, appOrigin);
    if (ownUrl !== null) return { allowed: true, url: ownUrl };

    let resolved: URL;
    try {
        resolved = new URL(url, appOrigin);
    } catch {
        return { allowed: false, code: UbiErrorCode.FETCH_INVALID_URL, message: `URL として不正です: ${url}` };
    }

    if (appOrigin && resolved.origin === appOrigin) {
        return {
            allowed: false,
            code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
            message: 'アプリ本体のコア API・コンテンツへのアクセスは許可されていません',
        };
    }

    if (resolved.protocol !== 'https:') {
        return {
            allowed: false,
            code: UbiErrorCode.FETCH_HTTPS_REQUIRED,
            message: `https 以外は許可されていません: ${resolved.protocol}//`,
        };
    }

    const domain = resolved.hostname;
    if (!authorizeExternalDomain) {
        return {
            allowed: false,
            code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
            message: '権限コンテキストが無いため外部通信できません',
            domain,
        };
    }

    if (!(await authorizeExternalDomain(modId, domain))) {
        return {
            allowed: false,
            code: UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
            message: `ユーザーが ${domain} への外部通信を許可していません`,
            domain,
        };
    }

    return { allowed: true, url: resolved.href };
}

export function useExternalUrlAuthorization(
    definition: WorkerModDefinition,
): (url: string) => Promise<ExternalUrlAccess> {
    const permissions = useUbiPermissions();
    const authorizeExternalDomain = permissions?.authorizeExternalDomain;
    const modId = definition.id.split(':')[0];
    const modBase = definition.modBase;
    const appOrigin = typeof window === 'undefined' ? undefined : window.location.origin;

    return useMemo(
        () => (url: string) => authorizeExternalUrl({ url, modBase, modId, appOrigin, authorizeExternalDomain }),
        [modBase, modId, appOrigin, authorizeExternalDomain],
    );
}
