/**
 * 固定ノートの中身（作ったワールド・mod・パブリックのお気に入り）。何を公開したとみなすかは worlds/publishedWorks.ts の条件
 * （ユーザーページと同じ）で、ここはノートの 1 件の形にするだけ。
 */
import { FEATURED_ITEMS_PER_NOTE, type WorldListItem, worldPagePath } from '@ubichill/shared';
import type { PublishedWorks } from '../../worlds/publishedWorks';
import type { FeaturedDeps, FeaturedSource } from './featured';

export interface FeaturedSourcesDeps {
    published: Pick<PublishedWorks, 'hostedWorlds' | 'externalEntries'>;
    /** 新しい順のお気に入り */
    latestFavorites(userId: string, limit: number): Promise<Array<{ worldRef: string; createdAt: Date }>>;
    /** 公開できるワールドなら一覧の 1 件（消えた・署名の無いものは undefined） */
    publishableListItem(ref: string): Promise<WorldListItem | undefined>;
}

const worldSource = (
    world: { displayName: string; description?: string | null; thumbnail?: string | null } & Parameters<
        typeof worldPagePath
    >[0],
    published: Date,
): FeaturedSource => ({
    name: world.displayName,
    description: world.description ?? null,
    image: world.thumbnail ?? null,
    path: worldPagePath(world),
    published,
});

export function createFeaturedSources(deps: FeaturedSourcesDeps): FeaturedDeps['sources'] {
    return {
        async worlds(owner) {
            const hosted = (await deps.published.hostedWorlds(owner.id)).map((h) => worldSource(h.world, h.createdAt));
            const external = (await deps.published.externalEntries(owner)).flatMap((entry) =>
                entry.world ? [worldSource(entry.world, entry.registeredAt)] : [],
            );
            return [...hosted, ...external];
        },
        async mods(owner) {
            return (await deps.published.externalEntries(owner)).flatMap((entry): FeaturedSource[] =>
                entry.mod
                    ? [
                          {
                              name: entry.mod.name,
                              description: null,
                              image: null,
                              path: `/@${owner.handle}/mods/${entry.mod.id}`,
                              version: entry.mod.version,
                              published: entry.registeredAt,
                          },
                      ]
                    : [],
            );
        },
        async favorites(owner) {
            // 公開できないもの（消えた・署名の無いワールド）を除いても足りるよう、多めに読む
            const entries = await deps.latestFavorites(owner.id, FEATURED_ITEMS_PER_NOTE * 2);
            const worlds = await Promise.all(
                entries.map((entry) => deps.publishableListItem(entry.worldRef).catch(() => undefined)),
            );
            return entries.flatMap((entry, i) => {
                const world = worlds[i];
                return world ? [worldSource(world, entry.createdAt)] : [];
            });
        },
    };
}
