import type { Instance } from '../schemas/instance.schema';
import type { WorldVisibility } from '../schemas/worldVisibility.schema';
import { isFullFor } from '../social/instanceAccess';

/** 作者の設定と公開の有無から決まる公開範囲。公開（署名した版）するまでは、設定にかかわらずプライベート。 */
export function effectiveWorldVisibility(setting: WorldVisibility, published: boolean): WorldVisibility {
    return published ? setting : 'private';
}

/**
 * ワールドのファイル（`<world>.yaml` など）を配るときに付ける、そのワールドの公開範囲。ほかの ubichill のサーバーは、
 * `private` なら自分のサーバーでその部屋を作らせない（作者の部屋に入るためにファイルは誰にでも配る）。
 */
export const WORLD_VISIBILITY_HEADER = 'Ubichill-World-Visibility';

/**
 * 配られたヘッダーの公開範囲。無い・知らない値は undefined（パブリックとして扱う）。
 * 途中の proxy が重ねたもの（`private, private` のように , でつながる）は、private が 1 つでもあれば private。
 */
export function worldVisibilityFromHeader(value: string | null | undefined): WorldVisibility | undefined {
    const values = (value ?? '').split(',').map((v) => v.trim().toLowerCase());
    if (values.includes('private')) return 'private';
    return values.includes('public') ? 'public' : undefined;
}

interface VisibleWorld {
    visibility?: WorldVisibility;
    authorId?: string;
}

/** 新しいインスタンスを作れるか（プライベートのワールドは作者だけ）。 */
export function canStartInstance(world: VisibleWorld, userId: string | null): boolean {
    return world.visibility !== 'private' || (userId !== null && world.authorId === userId);
}

/** ワールドに置くポータルの行き先にできるか（プライベートのワールドはできない。作者でも）。 */
export const isPortalDestination = (world: VisibleWorld): boolean => world.visibility !== 'private';

/** 部屋へのポータルを置けるか。プライベートのワールドの部屋は、その部屋を作った人だけが置ける。 */
export function canOpenRoomPortalTo(
    instance: Pick<Instance, 'leaderId'> & { world: VisibleWorld },
    userId: string | null,
): boolean {
    return instance.world.visibility !== 'private' || (userId !== null && instance.leaderId === userId);
}

/**
 * ワールドに置くポータルで入る部屋を選ぶ。見る人がそのまま入れるパブリックの部屋（このサーバーの部屋）のうち、
 * いちばん人のいる部屋（散らばらないように）。同じ人数なら先にできた部屋。無ければ null（新しく作る）。
 */
export function pickPortalInstance(instances: readonly Instance[], viewerId: string): Instance | null {
    const joinable = instances.filter(
        (instance) =>
            instance.access.type === 'public' &&
            !instance.remote &&
            instance.canJoin !== false &&
            !isFullFor(instance, viewerId),
    );
    const better = (a: Instance, b: Instance): Instance =>
        b.stats.currentUsers > a.stats.currentUsers ||
        (b.stats.currentUsers === a.stats.currentUsers && b.createdAt < a.createdAt)
            ? b
            : a;
    return joinable.length === 0 ? null : joinable.reduce(better);
}
