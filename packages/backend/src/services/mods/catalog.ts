import { externalWorkRepository, userRepository } from '@ubichill/db';
import { HANDLE_PATTERN, type PackageDescriptor, PackageIdSchema } from '@ubichill/shared';
import { safeFetch } from '../../lib/safeFetch';
import { logger } from '../../utils/logger';
import { selfAccount, selfDomain } from '../authors/authorKeys';
import { confirmedExternalMod } from '../worlds/externalWorkService';
import { worldRegistry } from '../worlds/worldRegistry';
import { createFederatedModCatalog } from './federatedCatalog';

export async function modDescriptor(handle: string, name: string): Promise<PackageDescriptor | undefined> {
    if (!HANDLE_PATTERN.test(handle) || !PackageIdSchema.safeParse(name).success) return undefined;
    const user = await userRepository.findByHandle(handle);
    if (!user) return undefined;
    const record = await externalWorkRepository.modByName(user.id, name);
    if (!record) return undefined;
    const author = selfAccount(handle);
    const mod = await confirmedExternalMod(record, author);
    return mod ? { author, id: mod.id, version: mod.version, baseUrl: mod.url } : undefined;
}

export async function modCatalog(query: string, offset: number, handle?: string) {
    const user = handle ? await userRepository.findByHandle(handle) : undefined;
    if (handle && !user) return { items: [], nextOffset: null };
    const rows = await externalWorkRepository.modPage(query.slice(0, 50), offset, user?.id);
    const items: PackageDescriptor[] = [];
    // 外部取得は最大 4 並列。確認結果は既存の TTL・件数上限付きキャッシュを共有する。
    for (let start = 0; start < rows.length; start += 4) {
        const batch = await Promise.all(
            rows.slice(start, start + 4).map(async ({ work, handle: owner }) => {
                if (!PackageIdSchema.safeParse(work.name).success) return undefined;
                const author = selfAccount(owner);
                const mod = await confirmedExternalMod(work, author);
                return mod ? { author, id: mod.id, version: mod.version, baseUrl: mod.url } : undefined;
            }),
        );
        items.push(...batch.filter((p): p is PackageDescriptor => !!p));
    }
    return { items, nextOffset: rows.length === 20 && offset < 10000 ? offset + 20 : null };
}

const federated = createFederatedModCatalog({
    peers: () => worldRegistry.listPeers(),
    // ピアのローカルの一覧（既定の scope）だけを取る。ピアが連合で知った mod まで取り込まない
    fetchPage: async (baseUrl, offset) => {
        const res = await safeFetch(`${baseUrl}/api/v1/mods?offset=${offset}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
            maxBytes: 256 * 1024,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },
    selfDomain,
    onError: (baseUrl, error) => logger.warn(`ピア ${baseUrl} の mod 一覧を取得できません:`, error),
});

/** フォロー中のサーバーが公開している mod（検索語はほかのサーバーへ送らない）。 */
export function federatedModCatalog(query: string) {
    return federated.search(query);
}
