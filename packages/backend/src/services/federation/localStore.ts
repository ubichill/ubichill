/**
 * 連合の部品が読む、このサーバーの事実（ユーザー・フレンド・来訪・部屋）。部品は DB を知らず、ここを注入される。
 */
import { instanceRepository, remoteFriendshipRepository, remoteVisitRepository, userRepository } from '@ubichill/db';
import { FEDERATION_LIMITS, profileLanguagesView, profileLinksView } from '@ubichill/shared';
import { isSystemUser } from '../users/systemUser';
import { worldRegistry } from '../worlds/worldRegistry';
import type { LocalUser } from './transport/documents';

export function createLocalStore(origin: string, now: () => number) {
    return {
        /** 連合の相手になれるこのサーバーのユーザーか（システムユーザーは除く） */
        userExists: async (userId: string) =>
            !isSystemUser(userId) && (await userRepository.findById(userId)) !== undefined,

        isFriend: async (userId: string, actorId: string) =>
            (await remoteFriendshipRepository.get(userId, actorId))?.state === 'accepted',

        /** ほかのサーバーの人との関係（相手のホームに答える語） */
        async friendshipStateOf(userId: string, actorId: string) {
            const row = await remoteFriendshipRepository.get(userId, actorId);
            return row?.state === 'accepted'
                ? ('friends' as const)
                : row?.state === 'outgoing' || row?.state === 'incoming'
                  ? row.state
                  : ('none' as const);
        },

        visitsOf: (userIds: readonly string[]) =>
            remoteVisitRepository.listFresh(userIds, new Date(now() - FEDERATION_LIMITS.VISIT_STALE_MS)),
        visitOf: async (userId: string) =>
            remoteVisitRepository.get(userId, new Date(now() - FEDERATION_LIMITS.VISIT_STALE_MS)),

        /** actor の文書に載せるプロフィール */
        async profileOf(userId: string): Promise<LocalUser | undefined> {
            if (isSystemUser(userId)) return undefined;
            const user = await userRepository.findProfileById(userId);
            return (
                user && {
                    id: user.id,
                    handle: user.handle,
                    name: user.name,
                    bio: user.bio ?? null,
                    image: user.image ?? null,
                    banner: user.bannerImage,
                    createdAt: user.createdAt,
                    profile: {
                        status: user.status,
                        links: profileLinksView(user.links),
                        languages: profileLanguagesView(user.languages),
                    },
                }
            );
        },

        async ownerOf(userId: string): Promise<{ id: string; handle: string } | undefined> {
            if (isSystemUser(userId)) return undefined;
            const user = await userRepository.findById(userId);
            return user && { id: user.id, handle: user.handle };
        },

        /** 部屋のサーバーとして答える部屋（公開範囲の判定に要る項目だけ） */
        rooms: {
            async find(instanceId: string) {
                const record = await instanceRepository.findById(instanceId);
                return (
                    record && {
                        id: record.id,
                        leaderId: record.leaderId,
                        accessType: record.accessType,
                        maxUsers: record.maxUsers,
                        worldRef: record.worldRef,
                    }
                );
            },
            async look(record: { worldRef: string }) {
                const world = await worldRegistry.getWorldByUrl(record.worldRef);
                return (
                    world && {
                        name: world.displayName,
                        image: world.thumbnail ? new URL(world.thumbnail, origin).href : null,
                    }
                );
            },
        },
    };
}
