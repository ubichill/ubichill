import { lockedMods, type ModLock } from '../schemas/modLock.schema';
import { compareVersions } from './versions';

export interface CapabilityAddition {
    modId: string;
    component: string;
    capabilities: string[];
}

/** 既存 package の権限天井が広がる更新。新規追加は別途 package 全体の権限を提示する。 */
export function addedModCapabilities(previous: ModLock | undefined, next: ModLock): CapabilityAddition[] {
    return Object.entries(lockedMods(next)).flatMap(([modId, entry]) => {
        const before = lockedMods(previous)[modId];
        if (!before) return [];
        return Object.entries(entry.components).flatMap(([component, item]) => {
            const allowed = new Set(before.components[component]?.capabilities ?? []);
            const capabilities = [...new Set(item.capabilities.filter((cap) => !allowed.has(cap)))];
            return capabilities.length ? [{ modId, component, capabilities }] : [];
        });
    });
}
export const describeCapabilityAdditions = (additions: CapabilityAddition[]): string =>
    additions.map((item) => `${item.component}: ${item.capabilities.join(', ')}`).join('\n');
export function assertCapabilityUpdate(previous: ModLock | undefined, next: ModLock, accepted: boolean): void {
    const additions = addedModCapabilities(previous, next);
    if (additions.length && !accepted)
        throw new Error(
            `追加される権限:\n${describeCapabilityAdditions(additions)}\n確認後 --accept-capabilities を指定してください`,
        );
}

/** カタログの登録順・latest ポインタを理由に、利用中の版を戻さない。 */
export function canAdvanceModVersion(current: string | undefined, candidate: string): boolean {
    return !current || current === 'latest' || compareVersions(candidate, current) >= 0;
}
