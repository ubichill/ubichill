import {
    INVITE_ANSWER_REFUSAL_MESSAGES,
    INVITE_REQUEST_REFUSAL_MESSAGES,
    type InviteCandidatesResponse,
    InviteRequestBodySchema,
    type InviteRequestResponse,
    SendInvitesRequestSchema,
    type SendInvitesResponse,
    type UserSummary,
} from '@ubichill/shared';
import { type RequestHandler, Router } from 'express';
import type { InviteService } from '../../services/social/invites/invites';
import { logger } from '../../utils/logger';

export interface InvitesRouterDeps {
    requireAuth: RequestHandler;
    /** 招待を送る回数 */
    inviteLimiter: RequestHandler;
    /** リクエストインバイトを送る・答える回数 */
    requestLimiter: RequestHandler;
    invites: InviteService;
    summariesOf(ids: readonly string[]): Promise<UserSummary[]>;
}

/**
 * 招待とリクエストインバイト（`/api/v1` の下）。
 * - `GET /instances/:id/invite-candidates`: 招待の画面に出すフレンド（送れるか・どこかにいるか）
 * - `POST /instances/:id/invites`: 部屋に招待する（1 人ずつの結果）
 * - `POST /social/invite-requests`: フレンドに「あなたのいる部屋に入れて」と頼む
 * - `POST /social/invite-requests/:userId/accept`: 頼まれたリクエストに招待で答える（いま自分がいる部屋へ）
 * - `DELETE /social/invite-requests/:userId`: 頼まれたリクエストを断る
 */
export function createInvitesRouter(deps: InvitesRouterDeps): Router {
    const router = Router();

    router.get('/instances/:id/invite-candidates', deps.requireAuth, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const candidates = await deps.invites.candidates(userId, String(req.params.id));
        if (!candidates) return void res.status(404).json({ error: 'インスタンスが見つかりません' });
        const users = new Map((await deps.summariesOf(candidates.map((c) => c.userId))).map((u) => [u.id, u]));
        res.set('Cache-Control', 'no-store').json({
            candidates: candidates.flatMap((c) => {
                const user = users.get(c.userId);
                return user ? [{ user, refusal: c.refusal, online: c.online }] : [];
            }),
        } satisfies InviteCandidatesResponse);
    });

    router.post('/instances/:id/invites', deps.requireAuth, deps.inviteLimiter, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const parsed = SendInvitesRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        }
        try {
            const outcome = await deps.invites.sendInvites(
                userId,
                String(req.params.id),
                parsed.data.userIds,
                parsed.data.message ?? null,
            );
            if (!outcome.ok) return void res.status(404).json({ error: 'インスタンスが見つかりません' });
            res.json({ results: outcome.results } satisfies SendInvitesResponse);
        } catch (error) {
            logger.error('招待を送れませんでした:', error);
            res.status(503).json({ error: '招待を送れませんでした' });
        }
    });

    router.post('/social/invite-requests', deps.requireAuth, deps.requestLimiter, async (req, res) => {
        const userId = req.user?.id;
        if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
        const parsed = InviteRequestBodySchema.safeParse(req.body);
        if (!parsed.success) return void res.status(400).json({ error: 'userId が必要です' });
        const outcome = await deps.invites.requestInvite(userId, parsed.data.userId);
        if (!outcome.ok) {
            return void res
                .status(409)
                .json({ error: INVITE_REQUEST_REFUSAL_MESSAGES[outcome.reason], reason: outcome.reason });
        }
        res.json({ alreadyRequested: outcome.alreadyRequested } satisfies InviteRequestResponse);
    });

    const answer = (accept: boolean): RequestHandler =>
        async function answerRequest(req, res) {
            const userId = req.user?.id;
            if (!userId) return void res.status(401).json({ error: 'Unauthorized' });
            const outcome = await deps.invites.answerRequest(userId, String(req.params.userId), accept);
            if (!outcome.ok) {
                return void res
                    .status(outcome.reason === 'no-request' ? 404 : 409)
                    .json({ error: INVITE_ANSWER_REFUSAL_MESSAGES[outcome.reason], reason: outcome.reason });
            }
            res.status(204).send();
        };
    router.post('/social/invite-requests/:userId/accept', deps.requireAuth, deps.requestLimiter, answer(true));
    router.delete('/social/invite-requests/:userId', deps.requireAuth, deps.requestLimiter, answer(false));

    return router;
}
