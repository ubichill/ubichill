/**
 * 人を引く: ユーザー検索・ID（`/@handle`・`handle@domain`）や内部 ID からプロフィールを引く。ほかのサーバーの人は
 * そのサーバーに問い合わせて引く（連合）。関係は relations.ts から重ねる。システムユーザーは出さない。
 */
import type { RemoteActorRecord, UserProfileRecord, UserRecord } from '@ubichill/db';
import {
    HANDLE_PATTERN,
    isRemoteUserId,
    parseAuthorAccount,
    parseUserSearchQuery,
    type UserProfileWithFriendship,
    type UserSearchResponse,
    type UserSummary,
    type UserWithFriendship,
} from '@ubichill/shared';
import type { Relations } from './relations';

const SEARCH_LIMIT = 20;

export interface PeopleDeps {
    relations: Pick<Relations, 'friendshipLookup' | 'ofRemote' | 'localProfile' | 'remoteProfile'>;
    users: {
        findById(id: string): Promise<UserRecord | undefined>;
        findByHandle(handle: string): Promise<UserRecord | undefined>;
        findProfileById(id: string): Promise<UserProfileRecord | undefined>;
        findProfileByHandle(handle: string): Promise<UserProfileRecord | undefined>;
        search(
            query: { handlePrefix: string | null; nameKey: string },
            options: { limit: number; excludeIds: readonly string[] },
        ): Promise<UserRecord[]>;
    };
    /** ほかのサーバーの actor を URL か `handle@domain` で引く（連合が無ければ null） */
    findRemoteActor(ref: string): Promise<RemoteActorRecord | null>;
    hiddenIdsFor(userId: string): Promise<ReadonlySet<string>>;
    /** システムユーザー（検索・プロフィール・ブロックの相手に出さない） */
    systemUserId: string;
    summaryOf(user: UserRecord): UserSummary;
    remoteSummaryOf(actor: RemoteActorRecord): UserSummary;
    selfDomain(): string;
}

/** 人として引ける actor（消えた actor・サーバーの actor は出さない）。 */
const personOf = (actor: RemoteActorRecord | null | undefined): RemoteActorRecord | null =>
    actor && !actor.deletedAt && actor.type === 'Person' ? actor : null;

export type SearchOutcome = { ok: true; response: UserSearchResponse } | { ok: false; error: 'too-long' };

export function createPeople(deps: PeopleDeps) {
    /** actor の URL かアカウント（`handle@domain`）から、ほかのサーバーの人を引く。引けなければ null（失敗も含む）。 */
    const findRemotePerson = async (ref: string): Promise<RemoteActorRecord | null> =>
        personOf(await deps.findRemoteActor(ref).catch(() => null));

    const localProfile = async (viewerId: string | undefined, user: UserProfileRecord | undefined) =>
        user ? deps.relations.localProfile(viewerId, user) : undefined;

    return {
        findRemotePerson,

        /** このサーバーのユーザーか、引けるほかのサーバーの人か（システムユーザーは居ないものとする）。 */
        async exists(userId: string): Promise<boolean> {
            if (isRemoteUserId(userId)) return (await findRemotePerson(userId)) !== null;
            return userId !== deps.systemUserId && (await deps.users.findById(userId)) !== undefined;
        },

        /** ID の前方一致・表示名の部分一致・`@handle@domain` の指定。自分との関係付き。ブロックした人は出さない。 */
        async search(viewerId: string, text: string): Promise<SearchOutcome> {
            const query = parseUserSearchQuery(text, deps.selfDomain());
            if (query.kind === 'tooLong') return { ok: false, error: 'too-long' };
            if (query.kind === 'empty') return { ok: true, response: { users: [] } };
            const hidden = await deps.hiddenIdsFor(viewerId);
            if (query.kind === 'remote') {
                const actor = await findRemotePerson(query.account);
                if (!actor || hidden.has(actor.id)) {
                    return { ok: true, response: { users: [], remoteAccount: query.account } };
                }
                const relation = await deps.relations.ofRemote(viewerId, actor);
                return { ok: true, response: { users: [{ ...deps.remoteSummaryOf(actor), ...relation }] } };
            }
            const [users, friendshipOf] = await Promise.all([
                query.kind === 'local'
                    ? deps.users
                          .findByHandle(query.handle)
                          .then((u) => (u && u.id !== deps.systemUserId && !hidden.has(u.id) ? [u] : []))
                    : deps.users.search(query, {
                          limit: SEARCH_LIMIT,
                          excludeIds: [deps.systemUserId, ...hidden],
                      }),
                deps.relations.friendshipLookup(viewerId),
            ]);
            return {
                ok: true,
                response: {
                    users: users.map(
                        (u): UserWithFriendship => ({ ...deps.summaryOf(u), friendship: friendshipOf(u.id) }),
                    ),
                },
            };
        },

        /** ID（`handle`・`handle@domain`）で引く（ユーザーページ）。ほかのサーバーのアカウントならそのサーバーに問い合わせる。 */
        async profileByHandle(
            viewerId: string | undefined,
            rawHandle: string,
        ): Promise<UserProfileWithFriendship | undefined> {
            const handle = rawHandle.toLowerCase();
            const account = handle.includes('@') ? parseAuthorAccount(handle) : null;
            if (account && account.domain !== deps.selfDomain()) {
                const actor = await findRemotePerson(handle);
                return actor ? deps.relations.remoteProfile(viewerId, actor) : undefined;
            }
            if (account) return localProfile(viewerId, await deps.users.findProfileByHandle(account.handle));
            return localProfile(
                viewerId,
                HANDLE_PATTERN.test(handle) ? await deps.users.findProfileByHandle(handle) : undefined,
            );
        },

        /** 内部 ID（ほかのサーバーの人は actor の URL）で引く。 */
        async profileById(
            viewerId: string | undefined,
            userId: string,
        ): Promise<UserProfileWithFriendship | undefined> {
            if (isRemoteUserId(userId)) {
                const actor = await findRemotePerson(userId);
                return actor ? deps.relations.remoteProfile(viewerId, actor) : undefined;
            }
            const user = await deps.users.findProfileById(userId);
            return user && user.id !== deps.systemUserId ? localProfile(viewerId, user) : undefined;
        },
    };
}

export type People = ReturnType<typeof createPeople>;
