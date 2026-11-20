/** フェディバースの設定とフォロワーの画面の実体（DB と連合をつなぐ）。手順は fediverseAccount.ts。 */
import { followerRepository, userRepository, userSettingsRepository } from '@ubichill/db';
import { selfAccount } from '../../authors/authorKeys';
import { type Federation, federation } from '../index';
import { createFediverseAccount } from './fediverseAccount';

const federationFollows = (f: Federation) => ({
    actorOf: (actorId: string) => f.actors.get(actorId),
    approve: (userId: string, actor: { id: string; inbox: string }) => f.follows.approve(userId, actor),
    reject: (userId: string, actor: { id: string; inbox: string }) => f.follows.reject(userId, actor),
});

export const fediverseAccountService = createFediverseAccount({
    findUser: (id) => userRepository.findById(id),
    accountOf: selfAccount,
    settingsOf: (userId) => userSettingsRepository.getFediverse(userId),
    updateSettings: (userId, changes) =>
        federation
            ? federation.updateFediverseSettings(userId, changes)
            : userSettingsRepository.updateFediverse(userId, changes),
    followers: followerRepository,
    federation: federation && federationFollows(federation),
});
