/**
 * 2 人がフレンドか（`POST /federation/v1/friendships/check`、Application actor の署名）。
 *
 * 答える（user のホームとして）: 尋ねてよいのは次のどちらかのサーバーだけ（ほかの人の付き合いを探らせない）。
 * - other のホーム（自分のサーバーの人との関係のずれを直すため）
 * - user が今来訪している部屋のサーバー（フレンド+・招待のみの部屋で、来訪者のフレンドを見せ・入れるため。
 *   部屋の見え方を尋ねる visibility で、すでにその部屋のサーバーへ「この人はフレンド」と伝えているのと同じ範囲）
 *
 * 尋ねる（部屋のサーバーとして）: 部屋にいるほかのサーバーの人のホームに、見る人がその人のフレンドかを尋ねる。答えは 30 秒使い回す。
 * 確かめる（other のホームとして）: このサーバーの人との関係を相手のホームに尋ね、ずれを直す（state 付きで答える）。
 */
import {
    type DomainPolicy,
    exchanges,
    FEDERATION_PATHS,
    type FederationProblem,
    type FriendshipCheckRequest,
    type FriendshipCheckResponse,
    FriendshipCheckResponseSchema,
    type FriendshipState,
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
    /** このサーバーのユーザーから見た actor との関係 */
    stateOf(userId: string, actorId: string): Promise<FriendshipState>;
    /** 来訪中のほかのサーバーの部屋（途切れていれば undefined） */
    visitOf(userId: string): Promise<{ roomUrl: string } | undefined>;
    now(): number;
}

type Outcome = { ok: true; value: FriendshipCheckResponse } | { ok: false; problem: FederationProblem };

export function createFriendshipCheck(deps: FriendshipCheckDeps) {
    const cache = createTtlCache<boolean>({ ttlMs: 30_000, max: 5000, now: deps.now });

    const query = async (member: string, viewer: string): Promise<FriendshipCheckResponse | null> => {
        const origin = originOf(member);
        const host = hostOf(member);
        if (!origin || !host || host === deps.identity.domain || !exchanges(deps.policyOf(host))) return null;
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
        return parsed?.success ? parsed.data : null;
    };

    return {
        async answer(signerHost: string, request: FriendshipCheckRequest): Promise<Outcome> {
            const userId = deps.identity.localUserIdOf(request.user);
            const forbidden: Outcome = { ok: false, problem: problemOf(403, 'forbidden', '尋ねられません') };
            if (!userId) return forbidden;
            const asksAboutOwnUser = hostOf(request.other) === signerHost;
            const visit = asksAboutOwnUser ? undefined : await deps.visitOf(userId);
            if (!asksAboutOwnUser && (!visit || hostOf(visit.roomUrl) !== signerHost)) return forbidden;
            const state = await deps.stateOf(userId, request.other);
            // 関係の向き（申請中など）は、相手のホームにだけ教える
            return { ok: true, value: { friends: state === 'friends', ...(asksAboutOwnUser ? { state } : {}) } };
        },

        /** member のホームに、viewer が member のフレンドかを尋ねる。尋ねられない・答えが無いときは false。 */
        ask(member: string, viewer: string): Promise<boolean> {
            return cache.getOrCreate(
                `${member}|${viewer}`,
                async () => (await query(member, viewer))?.friends === true,
            );
        },

        /** member のホームに、member から見た viewer（このサーバーの人）との関係を尋ねる。答えが無ければ null（使い回さない）。 */
        relationOf: (member: string, viewer: string) => query(member, viewer),
    };
}

export type FriendshipCheck = ReturnType<typeof createFriendshipCheck>;
