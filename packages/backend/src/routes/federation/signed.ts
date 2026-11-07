/**
 * 署名付きの要求を受ける口（RFC 9421）。本文は生のまま受け（Content-Digest を確かめるため）、署名した actor を res.locals に置く。
 * 失敗の理由は相手に返さずログにだけ残す（推測の手がかりを与えない）。
 */
import type { RemoteActorRecord } from '@ubichill/db';
import { type FederationErrorCode, problemOf } from '@ubichill/shared';
import type { Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { redis } from '../../lib/redis';
import { sharedRateLimit } from '../../lib/sharedRateLimit';
import type { Federation } from '../../services/federation';
import { logger } from '../../utils/logger';

export interface Signer {
    actor: RemoteActorRecord;
    host: string;
}

/** 署名した actor（signed を通ったあとだけ）。 */
export const signerOf = (res: Response): Signer => res.locals.signer as Signer;

export function sendProblem(res: Response, status: number, code: FederationErrorCode, title: string): void {
    res.status(status)
        .type('application/problem+json')
        .send(JSON.stringify(problemOf(status, code, title)));
}

/** 生の本文を JSON として読む（読めなければ undefined）。 */
export function jsonBody(req: Request): unknown {
    if (!Buffer.isBuffer(req.body)) return undefined;
    try {
        return JSON.parse(req.body.toString('utf8')) as unknown;
    } catch {
        return undefined;
    }
}

/** 署名を確かめる。kind で署名する actor の種類を絞る（人の操作は Person、サーバーの判断は Application）。 */
export function signed(
    federation: Federation,
    options: { kind: 'person' | 'application' | 'any'; requireNonce?: boolean },
): RequestHandler {
    return async (req, res, next) => {
        const result = await federation.verifier
            .verify(
                {
                    method: req.method,
                    originalUrl: req.originalUrl,
                    header: (name) => req.get(name),
                    rawBody: Buffer.isBuffer(req.body) ? req.body : undefined,
                },
                { requireNonce: options.requireNonce },
            )
            .catch((error: unknown) => {
                logger.warn('[federation] 署名の確認でエラー:', error);
                return { ok: false as const, status: 401 as const, reason: 'error' };
            });
        if (!result.ok) {
            logger.debug(`[federation] 署名を受けません (${result.reason}): ${req.method} ${req.originalUrl}`);
            return sendProblem(
                res,
                result.status,
                result.status === 403 ? 'forbidden' : 'unauthorized',
                '署名を確かめられません',
            );
        }
        const type = result.actor.type;
        if (
            (options.kind === 'person' && type !== 'Person') ||
            (options.kind === 'application' && type !== 'Application')
        ) {
            return sendProblem(res, 403, 'forbidden', 'この操作はできません');
        }
        res.locals.signer = { actor: result.actor, host: result.host } satisfies Signer;
        next();
    };
}

/** 署名したサーバーごとの回数（署名を確かめたあとに置く。ほかのサーバーは 1 つの IP から多く送ってくる）。 */
export function perHostLimit(name: string, limit: number): RequestHandler {
    return rateLimit({
        windowMs: 60 * 1000,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (_req, res) => signerOf(res).host,
        handler: (_req, res) => sendProblem(res, 429, 'rate-limited', '要求が多すぎます'),
        ...sharedRateLimit(`federation-${name}`, redis, logger),
    });
}

/** 署名の無い取得（actor の文書など）の回数を IP ごとに絞る。 */
export function perIpLimit(name: string, limit: number): RequestHandler {
    return rateLimit({
        windowMs: 60 * 1000,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => sendProblem(res, 429, 'rate-limited', '要求が多すぎます'),
        ...sharedRateLimit(`federation-${name}`, redis, logger),
    });
}
