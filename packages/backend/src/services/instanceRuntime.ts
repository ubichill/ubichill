import type { InstanceAPI, ResolvedWorld } from '@ubichill/shared';
import { appConfig } from '../config';
import { flattenGameObject } from './flattenGameObject';

export type RuntimePresence = InstanceAPI['schemas']['RuntimePresence'];
export type RuntimeGrant = InstanceAPI['schemas']['InstanceGrant'];

/** Go の管理API。SNSのDB・セッション情報はこの境界を越えない。 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${appConfig.runtime.url}/realtime/v1${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appConfig.runtime.token}` },
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok && response.status !== 409) throw new Error(`Instance runtime: ${response.status}`);
    return response;
}

export const instanceRuntime = {
    async presence(): Promise<Map<string, RuntimePresence>> {
        const response = await request('/instances');
        const data = (await response.json()) as { instances: RuntimePresence[] };
        return new Map(data.instances.map((instance) => [instance.id, instance]));
    },
    async provision(id: string, maxUsers: number, world: ResolvedWorld): Promise<void> {
        await request(`/instances/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({
                id,
                name: world.displayName,
                maxUsers,
                snapshot: {
                    entities: world.initialEntities.flatMap((entity) => flattenGameObject(entity)),
                    availableComponents: [],
                    activeMods: world.dependencies?.map((dependency) => dependency.name) ?? [],
                    environment: world.environment,
                    lock: world.lock,
                    sourceKind: world.source.kind,
                },
            }),
        });
    },
    async close(id: string, emptyBefore?: number): Promise<boolean> {
        const query = emptyBefore === undefined ? '' : `?emptyBefore=${emptyBefore}`;
        const response = await request(`/instances/${encodeURIComponent(id)}${query}`, { method: 'DELETE' });
        return response.status === 204;
    },
    async ticket(id: string, userId: string): Promise<RuntimeGrant> {
        const response = await request(`/instances/${encodeURIComponent(id)}/tickets`, {
            method: 'POST',
            body: JSON.stringify({ userId }),
        });
        return { ...((await response.json()) as RuntimeGrant), url: appConfig.runtime.publicUrl };
    },
};
