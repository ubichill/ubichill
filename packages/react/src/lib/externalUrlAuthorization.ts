import { resolveModAssetUrl, resolveModNamespaceUrl } from '@ubichill/sandbox';
import { UbiErrorCode } from '@ubichill/shared';

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

/** Ubi.fetch と Ubi.media.load が共有する、通信手段に依存しない外部URL認可。 */
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
