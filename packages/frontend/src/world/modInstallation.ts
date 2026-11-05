import type { Dependency } from '@ubichill/shared';
import type { ModAuthorCheck } from './modSignature';

export interface ModInstallationCheck {
    modId: string;
    version: string | null;
    result: ModAuthorCheck;
    allowed: boolean;
}

/** インストール直前に選んだ版を確認する。通信・解決の失敗では確定しない。 */
export async function checkModInstallation(
    dependencies: Dependency[],
    deps: {
        baseUrl: string;
        resolveLatest: (baseUrl: string, modId: string) => Promise<string | null>;
        checkAuthor: (baseUrl: string, modId: string, version: string) => Promise<ModAuthorCheck>;
        allowUnsigned: (baseUrl: string) => boolean;
    },
): Promise<ModInstallationCheck[]> {
    return Promise.all(
        dependencies.map(async (dependency) => {
            const baseUrl = dependency.source.url ?? deps.baseUrl;
            try {
                const version =
                    dependency.source.version === 'latest'
                        ? await deps.resolveLatest(baseUrl, dependency.name)
                        : dependency.source.version;
                const result: ModAuthorCheck = version
                    ? await deps.checkAuthor(baseUrl, dependency.name, version)
                    : { status: 'unavailable' };
                return {
                    modId: dependency.name,
                    version,
                    result,
                    allowed:
                        result.status === 'verified' ||
                        result.status === 'data-only' ||
                        (result.status === 'unsigned' && deps.allowUnsigned(baseUrl)),
                };
            } catch {
                return {
                    modId: dependency.name,
                    version: null,
                    result: { status: 'unavailable' } as const,
                    allowed: false,
                };
            }
        }),
    );
}
