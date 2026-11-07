/**
 * ほかのサーバーの部屋（RoomCard）を、画面の Instance の形にする。部屋の一覧・フレンドの現在地・入室の画面を、
 * このサーバーの部屋と同じ部品で出すため。ワールドの確認（作者の署名）は、見る人のサーバーが URL から行ったものだけを載せる。
 */
import type { Instance, RoomCard, WorldIdentity, WorldMod, WorldSource } from '@ubichill/shared';

export interface CheckedWorld {
    id: string;
    version: string;
    displayName: string;
    description?: string;
    thumbnail?: string;
    authorName?: string;
    source?: WorldSource;
    mods?: WorldMod[];
    identity?: WorldIdentity;
}

export function remoteInstanceOf(
    room: RoomCard,
    input: { address: string; domain: string; canJoin: boolean; world?: CheckedWorld; seenAt: Date },
): Instance {
    const world = input.world;
    return {
        id: input.address,
        status: room.members >= room.capacity ? 'full' : 'active',
        leaderId: room.leader,
        createdAt: input.seenAt.toISOString(),
        expiresAt: null,
        world: {
            id: world?.id ?? room.world.url,
            version: world?.version ?? '',
            // 名前と画像は部屋のサーバーの言い分（表示だけ）。作者の確認は見る人のサーバーが行った結果だけ
            displayName: room.name,
            ...(world?.description ? { description: world.description } : {}),
            ...(room.image ? { thumbnail: room.image } : {}),
            authorId: '',
            ...(world?.authorName ? { authorName: world.authorName } : {}),
            ...(world?.source ? { source: world.source } : {}),
            mods: world?.mods ?? [],
            ...(world?.identity ? { identity: world.identity } : {}),
        },
        access: { type: room.accessType, tags: [], password: false },
        stats: { currentUsers: room.members, maxUsers: room.capacity },
        connection: { url: '', namespace: '' },
        canJoin: input.canJoin,
        remote: { domain: input.domain, url: room.id },
    };
}
