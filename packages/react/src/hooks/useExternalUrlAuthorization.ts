import { useMemo } from 'react';
import { useUbiPermissions } from '../components/PermissionContext';
import { authorizeExternalUrl, type ExternalUrlAccess } from '../lib/externalUrlAuthorization';
import type { WorkerModDefinition } from '../types';

export function useExternalUrlAuthorization(
    definition: WorkerModDefinition,
): (url: string, signal?: AbortSignal) => Promise<ExternalUrlAccess> {
    const permissions = useUbiPermissions();
    const authorizeExternalDomain = permissions?.authorizeExternalDomain;
    const modId = definition.id.split(':')[0];
    const modBase = definition.modBase;
    const appOrigin = typeof window === 'undefined' ? undefined : window.location.origin;

    return useMemo(
        () => (url: string, signal?: AbortSignal) =>
            authorizeExternalUrl({ url, modBase, modId, appOrigin, authorizeExternalDomain, signal }),
        [modBase, modId, appOrigin, authorizeExternalDomain],
    );
}
