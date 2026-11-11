import { externalWorkRepository, userRepository } from '@ubichill/db';
import { HANDLE_PATTERN, type PackageDescriptor, PackageIdSchema } from '@ubichill/shared';
import { selfAccount } from '../authors/authorKeys';
import { confirmedExternalMod } from '../worlds/externalWorkService';

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
