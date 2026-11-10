/**
 * 部屋 RPC 面（`/federation/v1/...`）。部屋のことは部屋のサーバーが同期で答える。
 * 入室・招待の権利は人の鍵と nonce（同じ要求を 2 度使わせない）、見えるかは中にいる人のホーム（Application actor）、
 * 現在地は見る人の鍵。署名した actor が操作の主体で、本文で別の主体を名乗れない。
 */
import type { RemoteActorRecord } from '@ubichill/db';
import {
    FriendshipCheckRequestSchema,
    GrantRequestSchema,
    JoinRequestSchema,
    PresenceRequestSchema,
    VisibilityRequestSchema,
} from '@ubichill/shared';
import { type Request, type Response, Router } from 'express';
import type { z } from 'zod';
import type { Federation } from '../../services/federation';
import type { Visitor } from '../../services/federation/ubichill/rooms';
import { logger } from '../../utils/logger';
import { jsonBody, perHostLimit, sendProblem, signed, signerOf } from './signed';

const visitorOf = (actor: RemoteActorRecord): Visitor => ({
    id: actor.id,
    domain: actor.domain,
    name: actor.name,
    account: actor.account,
});

/** 本文を読む（読めなければ 400 を返して undefined）。 */
function readBody<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | undefined {
    const parsed = schema.safeParse(jsonBody(req));
    if (parsed.success) return parsed.data;
    sendProblem(res, 400, 'bad-request', '本文の形が違います');
    return undefined;
}

export function createRpcRouter(federation: Federation): Router {
    const router = Router();
    const fail = (res: Response, error: unknown) => {
        logger.error('[federation] RPC の処理に失敗:', error);
        sendProblem(res, 503, 'unavailable', 'いまは答えられません');
    };

    router.post(
        '/rooms/join',
        signed(federation, { kind: 'person', requireNonce: true }),
        perHostLimit('join', 120),
        async (req, res) => {
            const body = readBody(JoinRequestSchema, req, res);
            if (!body) return;
            try {
                const outcome = await federation.rooms.join(visitorOf(signerOf(res).actor), body);
                if (!outcome.ok)
                    return sendProblem(res, outcome.problem.status, outcome.problem.code, outcome.problem.title);
                res.set('Cache-Control', 'no-store').json(outcome.value);
            } catch (error) {
                fail(res, error);
            }
        },
    );

    router.post(
        '/rooms/grants',
        signed(federation, { kind: 'person', requireNonce: true }),
        perHostLimit('grants', 60),
        async (req, res) => {
            const body = readBody(GrantRequestSchema, req, res);
            if (!body) return;
            try {
                const outcome = await federation.rooms.grant(visitorOf(signerOf(res).actor), body);
                if (!outcome.ok)
                    return sendProblem(res, outcome.problem.status, outcome.problem.code, outcome.problem.title);
                res.json(outcome.value);
            } catch (error) {
                fail(res, error);
            }
        },
    );

    router.post(
        '/rooms/visibility',
        signed(federation, { kind: 'application' }),
        perHostLimit('visibility', 600),
        async (req, res) => {
            const body = readBody(VisibilityRequestSchema, req, res);
            if (!body) return;
            try {
                const outcome = await federation.rooms.visibility(signerOf(res).host, body);
                if (!outcome.ok)
                    return sendProblem(res, outcome.problem.status, outcome.problem.code, outcome.problem.title);
                res.json(outcome.value);
            } catch (error) {
                fail(res, error);
            }
        },
    );

    router.post(
        '/presence',
        signed(federation, { kind: 'person' }),
        perHostLimit('presence', 600),
        async (req, res) => {
            const body = readBody(PresenceRequestSchema, req, res);
            if (!body) return;
            try {
                res.json(await federation.presence.answer(signerOf(res).actor.id, body.subjects));
            } catch (error) {
                fail(res, error);
            }
        },
    );

    router.post(
        '/friendships/check',
        signed(federation, { kind: 'application' }),
        perHostLimit('friendships', 300),
        async (req, res) => {
            const body = readBody(FriendshipCheckRequestSchema, req, res);
            if (!body) return;
            try {
                const outcome = await federation.friendshipCheck.answer(signerOf(res).host, body);
                if (!outcome.ok)
                    return sendProblem(res, outcome.problem.status, outcome.problem.code, outcome.problem.title);
                res.json(outcome.value);
            } catch (error) {
                fail(res, error);
            }
        },
    );

    return router;
}
