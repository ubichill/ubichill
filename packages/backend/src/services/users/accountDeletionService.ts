/** 本番の DB・インスタンスにつないだアカウントの削除（退会）。手順と規則は deleteAccount.ts。 */
import { accountDeletionRepository, instanceRepository, userRepository } from '@ubichill/db';
import { logger } from '../../utils/logger';
import { instanceManager } from '../instances/instanceManager';
import { worldRegistry } from '../worlds/worldRegistry';
import { type DeleteAccountOutcome, deleteAccount } from './deleteAccount';

export const accountDeletionService = {
    deleteAccount: (userId: string, confirmHandle: unknown): Promise<DeleteAccountOutcome> =>
        deleteAccount(
            {
                findUser: (id) => userRepository.findById(id),
                openRooms: async (id) => (await instanceRepository.findByLeaderId(id)).map((room) => room.id),
                closeRoom: async (roomId, id) => (await instanceManager.closeInstance(roomId, id)).success,
                retire: (id) => accountDeletionRepository.retire(id),
                closeOrphanedRoom: (roomId) => instanceManager.closeOrphanedRoom(roomId),
                warnOrphanedRoom: (roomId) => logger.warn(`退会で消えた部屋を閉じられませんでした: ${roomId}`),
                afterDeleted: (id, handle) => {
                    worldRegistry.invalidateResolvedWorlds();
                    logger.info(`アカウントを削除しました: @${handle} (${id})`);
                },
            },
            { userId, confirmHandle },
        ),
};
