/**
 * 2 人がフレンドか（`POST /federation/v1/friendships/check`、Application actor の署名）。
 *
 * 答える（user のホームとして）: 尋ねてよいのは次のどちらかのサーバーだけ（ほかの人の付き合いを探らせない）。
 * - other のホーム（自分のサーバーの人との関係のずれを直すため）
 * - user が今来訪している部屋のサーバー（フレンド+・招待のみの部屋で、来訪者のフレンドを見せ・入れるため。
 *   部屋の見え方を尋ねる visibility で、すでにその部屋のサーバーへ「この人はフレンド」と伝えているのと同じ範囲）
 *
 * 尋ねる（部屋のサーバーとして）: 部屋にいるほかのサーバーの人のホームに、見る人がその人のフレンドかを尋ねる。答えは 30 秒使い回す。
 */
import {
    type DomainPolicy,
    exchanges,
    FEDERATION_PATHS,
    type FederationProblem,
    type FriendshipCheckRequest,
    FriendshipCheckResponseSchema,
    hostOf,
    originOf,
    problemOf,
    SIGNATURE_TIMING,
} from '@ubichill/shared';
import { createTtlCache } from '../../utils/ttlCache';
import type { FederationIdentity } from './identity';
import type { Transport } from './transport';

export interface FriendshipCheckDeps {
    identity: FederationIdentity;
    transport: Pick<Transport, 'post'>;
    policyOf(domain: string): DomainPolicy;
    /** このサーバーのユーザーと actor がフレンドか */
    isFriend(userId: string, actorId: string): Promise<boolean>;
    /** 来訪中のほかのサーバーの部屋（途切れていれば undefined） */
    visitOf(userId: string): Promise<{ roomUrl: string } | undefined>;
    now(): number;
}

type Outcome = { ok: true; value: { friends: boolean } } | { ok: false; problem: FederationProblem };

export function createFriendshipCheck(deps: FriendshipCheckDeps) {
    const cache = createTtlCache<boolean>({ ttlMs: 30_000, max: 5000, now: deps.now });

    return {
        async answer(signerHost: string, request: FriendshipCheckRequest): Promise<Outcome> {
            const userId = deps.identity.localUserIdOf(request.user);
            const forbidden: Outcome = { ok: false, problem: problemOf(403, 'forbidden', '尋ねられません') };
            if (!userId) return forbidden;
            const asksAboutOwnUser = hostOf(request.other) === signerHost;
            const visit = asksAboutOwnUser ? undefined : await deps.visitOf(userId);
            if (!asksAboutOwnUser && (!visit || hostOf(visit.roomUrl) !== signerHost)) return forbidden;
            return { ok: true, value: { friends: await deps.isFriend(userId, request.other) } };
        },

        /** member のホームに、viewer が member のフレンドかを尋ねる。尋ねられない・答えが無いときは false。 */
        ask(member: string, viewer: string): Promise<boolean> {
            return cache.getOrCreate(`${member}|${viewer}`, async () => {
                const origin = originOf(member);
                const host = hostOf(member);
                if (!origin || !host || host === deps.identity.domain || !exchanges(deps.policyOf(host))) return false;
                const response = await deps.transport
                    .post(
                        `${origin}${FEDERATION_PATHS.rpc.friendshipCheck}`,
                        { user: member, other: viewer } satisfies FriendshipCheckRequest,
                        {
                            signAs: { kind: 'app' },
                            ttlSec: SIGNATURE_TIMING.RPC_TTL_SEC,
                            contentType: 'application/json',
                            maxBytes: 4 * 1024,
                        },
                    )
                    .catch(() => null);
                const parsed = response?.status === 200 ? FriendshipCheckResponseSchema.safeParse(response.json) : null;
                return parsed?.success === true && parsed.data.friends;
            });
        },
    };
}

export type FriendshipCheck = ReturnType<typeof createFriendshipCheck>;
