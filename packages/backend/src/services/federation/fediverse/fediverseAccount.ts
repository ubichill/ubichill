/**
 * フェディバース（Mastodon・Misskey など）とのつながりの画面: 設定・承認待ち・フォロワーと、承認・断る。
 * DB と連合は注入する（実体は fediverseAccountService.ts）。フォローの規則そのものは follows.ts。
 */
import type { FollowerWithActor } from '@ubichill/db';
import {
    type CustomEmoji,
    FEDIVERSE_LIMITS,
    type FediverseFollower,
    type FediverseOverview,
    type FediverseSettings,
    type FediverseSettingsUpdate,
    remoteEmojisOf,
} from '@ubichill/shared';
import type { FollowActor, FollowerAction } from './follows';

function emojisOf(profile: unknown): { emojis?: CustomEmoji[] } {
    const emojis = remoteEmojisOf(profile);
    return emojis.length > 0 ? { emojis } : {};
}

export const followerOf = (row: FollowerWithActor): FediverseFollower => ({
    actorId: row.actorId,
    account: row.account,
    name: row.name,
    icon: row.icon,
    url: row.url,
    state: row.state,
    since: row.updatedAt.toISOString(),
    ...emojisOf(row.profile),
});

type Actor = Pick<FollowActor, 'id' | 'inbox'>;

export interface FediverseAccountDeps {
    findUser(id: string): Promise<{ handle: string } | undefined>;
    accountOf(handle: string): string;
    settingsOf(userId: string): Promise<FediverseSettings>;
    /** 設定を保存する（連合していれば、承認制をやめたときに承認待ちをまとめて承認し、プロフィールを届け直す） */
    updateSettings(userId: string, changes: FediverseSettingsUpdate): Promise<FediverseSettings>;
    followers: {
        get(userId: string, actorId: string): Promise<{ actorId: string } | undefined>;
        listForUser(userId: string, state: 'pending' | 'accepted', limit: number): Promise<FollowerWithActor[]>;
        countAccepted(userId: string): Promise<number>;
    };
    /** 連合していなければ null */
    federation: {
        actorOf(actorId: string): Promise<Actor | null>;
        approve(userId: string, actor: Actor): Promise<boolean>;
        reject(userId: string, actor: Actor): Promise<FollowerAction>;
    } | null;
}

export type FollowerAnswer = 'done' | 'not-federated' | 'not-found' | 'not-pending';

export function createFediverseAccount(deps: FediverseAccountDeps) {
    return {
        /** このサーバーが連合しているか（していなければ承認・断るはできない） */
        federated: deps.federation !== null,

        /** アカウント・設定・承認待ち・フォロワー。ユーザーがいなければ null。 */
        async overview(userId: string): Promise<FediverseOverview | null> {
            const user = await deps.findUser(userId);
            if (!user) return null;
            const [settings, pending, followers, followerCount] = await Promise.all([
                deps.settingsOf(userId),
                deps.followers.listForUser(userId, 'pending', FEDIVERSE_LIMITS.FOLLOWERS_PAGE),
                deps.followers.listForUser(userId, 'accepted', FEDIVERSE_LIMITS.FOLLOWERS_PAGE),
                deps.followers.countAccepted(userId),
            ]);
            return {
                enabled: deps.federation !== null,
                account: deps.accountOf(user.handle),
                settings,
                pending: pending.map(followerOf),
                followers: followers.map(followerOf),
                followerCount,
            };
        },

        updateSettings: (userId: string, changes: FediverseSettingsUpdate): Promise<FediverseSettings> =>
            deps.updateSettings(userId, changes),

        /** 承認待ちを承認する・断る（フォロワーから外すのも reject）。 */
        async answerFollower(userId: string, actorId: string, action: 'approve' | 'reject'): Promise<FollowerAnswer> {
            if (!deps.federation) return 'not-federated';
            const row = await deps.followers.get(userId, actorId);
            const actor = row ? await deps.federation.actorOf(row.actorId) : null;
            if (!actor) return 'not-found';
            const done =
                action === 'approve'
                    ? await deps.federation.approve(userId, actor)
                    : (await deps.federation.reject(userId, actor)) === 'rejected';
            return done ? 'done' : 'not-pending';
        },
    };
}

export type FediverseAccount = ReturnType<typeof createFediverseAccount>;
