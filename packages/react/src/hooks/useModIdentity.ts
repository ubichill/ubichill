import { useMemo } from 'react';
import { useServiceTokenRequester } from '../components/ServiceTokenContext';
import { createModIdentity, type ModIdentityHandler } from '../lib/modIdentity';
import type { WorkerModDefinition } from '../types';
import { useExternalUrlAuthorization } from './useExternalUrlAuthorization';

/** Worker の Ubi.identity.token() を処理するハンドラ（宛先の認可は fetch と共通）。 */
export function useModIdentity(definition: WorkerModDefinition): ModIdentityHandler {
    const authorizeUrl = useExternalUrlAuthorization(definition);
    const requestToken = useServiceTokenRequester();
    const modId = definition.id.split(':')[0] ?? definition.id;
    return useMemo(() => createModIdentity({ modId, authorizeUrl, requestToken }), [modId, authorizeUrl, requestToken]);
}
