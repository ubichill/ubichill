import {
    type CreateInstanceRequest,
    type Instance,
    isPortalDestination,
    pickPortalInstance,
    type WorldListItem,
} from '@ubichill/shared';

/** 作ってから入るまで（今の部屋を出る・署名なしの確認）に、空の部屋として掃除されないように頼む時間。 */
export const WORLD_PORTAL_HOLD_MS = 30_000;

export const PRIVATE_WORLD_PORTAL_MESSAGE = 'プライベートのワールドには、ポータルから入れません';

export interface WorldPortalEntryDeps {
    fetchWorld: (ref: string) => Promise<Pick<WorldListItem, 'url' | 'visibility'>>;
    fetchInstances: (worldRef: string) => Promise<Instance[]>;
    createInstance: (request: CreateInstanceRequest) => Promise<Instance>;
}

/**
 * ワールドに置くポータルで入る部屋。見る人がそのまま入れるパブリックの部屋のうち、いちばん人のいる部屋（散らばらない）。
 * 無ければパブリックの部屋を作る。プライベートのワールドは、作者でも断る（ポータルの行き先にできない）。
 * 同時に通った人がそれぞれ部屋を作ることはある（次に通る人は人のいる方へ集まる）。
 */
export async function worldPortalInstance(
    deps: WorldPortalEntryDeps,
    worldRef: string,
    viewerId: string,
): Promise<Instance> {
    const world = await deps.fetchWorld(worldRef);
    if (!isPortalDestination(world)) throw new Error(PRIVATE_WORLD_PORTAL_MESSAGE);
    const existing = pickPortalInstance(await deps.fetchInstances(world.url), viewerId);
    return (
        existing ??
        deps.createInstance({ worldId: world.url, access: { type: 'public' }, holdEmptyMs: WORLD_PORTAL_HOLD_MS })
    );
}
