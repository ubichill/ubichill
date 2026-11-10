/**
 * ユーザーが公開した作品（作ったワールド・外部に置いたワールドと mod）。ユーザーページ（`/users/:userId/worlds`・`/mods`）と
 * 連合の固定ノートで同じ条件にする:
 * - 本体に作ったワールド: 署名して公開したもの（isPublishable）だけ
 * - 外部の作品: いま本人の署名付きで配られていると確かめられたものだけ（externalWorkStore）
 * - リポジトリ（worlds/）のワールド: 作者アカウントが本人のもの（ユーザーページだけ。画面からは編集できない）
 */
import type { WorldRecord } from '@ubichill/db';
import { isPublishable, type PublishedMod, type ResolvedWorld, type WorldListItem } from '@ubichill/shared';
import type { PublishedExternalEntry } from './externalWorkStore';

export interface PublishedWorksDeps {
    worldsByAuthor(userId: string): Promise<WorldRecord[]>;
    getWorld(worldId: string): Promise<ResolvedWorld | undefined>;
    repositoryWorldsByAuthor(accounts: readonly string[]): Promise<ResolvedWorld[]>;
    externalEntries(userId: string, account: string): Promise<PublishedExternalEntry[]>;
    /** 作者アカウント `handle@domain` */
    accountOf(handle: string): string;
}

export interface WorksOwner {
    id: string;
    handle: string;
}

/** リポジトリで管理しているワールドの一覧の 1 件（画面からは編集・削除できない）。 */
export const repositoryWorldView = (w: ResolvedWorld) => ({
    id: w.id,
    displayName: w.displayName,
    description: w.description ?? null,
    thumbnail: w.thumbnail ?? null,
    version: w.version,
    capacity: w.capacity,
    identity: w.identity,
    managedBy: 'repository' as const,
});

/** 外部（GitHub Pages など）に置いたワールド。開くときは URL で入る。 */
export const externalWorldView = (w: WorldListItem) => ({
    id: w.id,
    url: w.url,
    displayName: w.displayName,
    description: w.description ?? null,
    thumbnail: w.thumbnail ?? null,
    version: w.version,
    capacity: w.capacity,
    identity: w.identity,
    managedBy: 'external' as const,
});

/** 本体に作ったワールドの公開する項目（公開メタデータだけ）。 */
const hostedWorldView = (w: ResolvedWorld) => ({
    id: w.id,
    displayName: w.displayName,
    description: w.description ?? null,
    thumbnail: w.thumbnail ?? null,
    version: w.version,
    capacity: w.capacity,
});

export function createPublishedWorks(deps: PublishedWorksDeps) {
    /** 本体に作って署名したワールド（作った時刻つき。作った順は DB の順のまま）。 */
    const hostedWorlds = async (userId: string): Promise<Array<{ world: ResolvedWorld; createdAt: Date }>> => {
        const records = await deps.worldsByAuthor(userId);
        const resolved = await Promise.all(records.map((r) => deps.getWorld(r.id)));
        return records.flatMap((record, i) => {
            const world = resolved[i];
            return world && isPublishable(world.identity) ? [{ world, createdAt: record.createdAt }] : [];
        });
    };

    const externalEntries = (owner: WorksOwner): Promise<PublishedExternalEntry[]> =>
        deps.externalEntries(owner.id, deps.accountOf(owner.handle));

    return {
        hostedWorlds,
        externalEntries,

        /**
         * ユーザーページの「作ったワールド」: 本体・リポジトリ・外部の順。owner が居なければ（消えたユーザー）本体の分だけ。
         * 本体の分は userId で引く（owner の有無を待たない）。
         */
        async worldsOf(userId: string, owner: WorksOwner | undefined) {
            const hosted = (await hostedWorlds(userId)).map((h) => hostedWorldView(h.world));
            const repository = (await deps.repositoryWorldsByAuthor(owner ? [deps.accountOf(owner.handle)] : [])).map(
                repositoryWorldView,
            );
            const external = owner
                ? (await externalEntries(owner)).flatMap((e) => (e.world ? [externalWorldView(e.world)] : []))
                : [];
            return [...hosted, ...repository, ...external];
        },

        /** ユーザーが公開している mod（外部に置いたもののうち、いま本人の署名付きで配られているもの）。 */
        async modsOf(owner: WorksOwner): Promise<PublishedMod[]> {
            return (await externalEntries(owner)).flatMap((e) => (e.mod ? [e.mod] : []));
        },
    };
}

export type PublishedWorks = ReturnType<typeof createPublishedWorks>;
