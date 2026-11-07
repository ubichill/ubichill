/**
 * AP 面（`/ap/...`）: このサーバーの actor の文書・inbox・outbox と、部屋の作り。
 * - actor の文書は誰でも取れる（鍵を確かめるため）。ブラウザで開いたらプロフィールの画面へ送る
 * - inbox は署名した actor からだけ受ける（受けたら 202。2 度目・知らない型も 202）
 * - 部屋の作りは、署名した人（見る人）に見える部屋だけ答える（見えなければ無い部屋と同じ 404）
 */
import { ACTIVITY_CONTENT_TYPE, AS_CONTEXT, FEDERATION_LIMITS, isActivityMediaType } from '@ubichill/shared';
import { Router } from 'express';
import type { Federation } from '../../services/federation';
import { logger } from '../../utils/logger';
import { jsonBody, perHostLimit, perIpLimit, sendProblem, signed, signerOf } from './signed';

const AP_TYPES = ['application/activity+json', 'application/ld+json', 'application/json', 'text/html'];

export function createActivityPubRouter(federation: Federation): Router {
    const router = Router();
    const documents = perIpLimit('ap-documents', 600);
    const sendDocument = (res: import('express').Response, doc: Record<string, unknown>) => {
        res.set('Cache-Control', 'public, max-age=300');
        res.type(ACTIVITY_CONTENT_TYPE).send(JSON.stringify(doc));
    };

    router.get('/actor', documents, (_req, res) => sendDocument(res, federation.localActors.application()));

    router.get('/users/:id', documents, async (req, res) => {
        const doc = await federation.localActors.person(String(req.params.id));
        if (!doc) return sendProblem(res, 404, 'not-found', 'ユーザーが見つかりません');
        // ブラウザで開いたらプロフィールの画面へ
        if (req.accepts(AP_TYPES) === 'text/html' && typeof doc.url === 'string') return res.redirect(302, doc.url);
        sendDocument(res, doc);
    });

    router.get('/users/:id/outbox', documents, (req, res) => {
        // 公開の投稿は無い（人から人への知らせだけを、相手の inbox へ直接送る）
        sendDocument(res, {
            '@context': AS_CONTEXT,
            id: federation.identity.outboxUrl(String(req.params.id)),
            type: 'OrderedCollection',
            totalItems: 0,
            orderedItems: [],
        });
    });

    const inbox = [
        (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
            if (!isActivityMediaType(req.get('content-type')))
                return sendProblem(res, 415, 'bad-request', 'activity+json で送ってください');
            if (!Buffer.isBuffer(req.body) || req.body.length > FEDERATION_LIMITS.INBOX_BODY_BYTES) {
                return sendProblem(res, 400, 'bad-request', '本文を読めません');
            }
            next();
        },
        signed(federation, { kind: 'any' }),
        perHostLimit('inbox', 300),
        async (req: import('express').Request, res: import('express').Response) => {
            const json = jsonBody(req);
            if (json === undefined) return sendProblem(res, 400, 'bad-request', '本文を読めません');
            try {
                const outcome = await federation.inbox.receive(signerOf(res).actor, json);
                if (outcome === 'accepted') return res.status(202).end();
                return sendProblem(
                    res,
                    outcome === 'forbidden' ? 403 : 400,
                    outcome === 'forbidden' ? 'forbidden' : 'bad-request',
                    '受けられません',
                );
            } catch (error) {
                logger.error('[federation] inbox の処理に失敗:', error);
                return sendProblem(res, 503, 'unavailable', 'いまは受けられません');
            }
        },
    ];
    router.post('/inbox', ...inbox);
    router.post('/users/:id/inbox', ...inbox);

    router.get(
        '/instances/:id',
        signed(federation, { kind: 'person' }),
        perHostLimit('rooms', 600),
        async (req, res) => {
            const described = await federation.rooms.describe(signerOf(res).actor.id, String(req.params.id));
            if (!described) return sendProblem(res, 404, 'not-found', '部屋が見つかりません');
            res.set('Cache-Control', 'no-store').json(described);
        },
    );

    return router;
}
