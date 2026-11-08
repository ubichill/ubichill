import {
    CreateInstanceRequestSchema,
    FEDERATION_LIMITS,
    isRemoteUserId,
    ListInstancesQuerySchema,
} from '@ubichill/shared';
import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { appConfig } from '../config';
import { redis } from '../lib/redis';
import { sharedRateLimit } from '../lib/sharedRateLimit';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { type Federation, federation } from '../services/federation';
import { remoteInstanceOf } from '../services/federation/remoteInstance';
import type { TravelError } from '../services/federation/travel';
import { InstanceJoinRejected, instanceManager } from '../services/instances/instanceManager';
import { worldRegistry } from '../services/worlds/worldRegistry';
import { logger } from '../utils/logger';

const router = Router();

// ── ほかのサーバーの部屋（連合。住所は `<部屋の ID>@<ドメイン>`） ──

const TRAVEL_ERRORS: Record<TravelError, { status: number; error: string }> = {
    blocked: { status: 404, error: 'このサーバーの部屋には入れません' },
    'not-found': { status: 404, error: 'インスタンスが見つからないか、入れる人が限られています（フレンドのみなど）' },
    'invite-required': { status: 403, error: 'このインスタンスに入るには招待が要ります' },
    full: { status: 403, error: '満員です' },
    rejected: { status: 403, error: 'このインスタンスには入れません' },
    unavailable: { status: 503, error: '部屋のサーバーにつながりません' },
};

/** ブラウザの origin（チケットを結び付ける）。許した画面の origin だけを使い、ほかは既定の画面の origin。 */
function clientOriginOf(req: Request, f: Federation): string {
    const origin = req.get('origin');
    const allowed = Array.isArray(appConfig.cors.origin) ? appConfig.cors.origin : [];
    return origin && (allowed.includes(origin) || origin === f.identity.origin || origin === f.frontendOrigin)
        ? origin
        : f.frontendOrigin;
}

/**
 * 会いに行くフレンド（画面が現在地で見た、その部屋にいるフレンドの ID）を actor の URL にする。
 * 部屋のサーバーが、中にいる人の多い部屋でもこの人たちとの関係から先に確かめるため。関係そのものはホームに確かめる。
 */
function viaOf(raw: unknown, f: Federation): string[] {
    return ([] as unknown[])
        .concat(raw ?? [])
        .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048)
        .slice(0, FEDERATION_LIMITS.MAX_FRIENDSHIP_CHECKS)
        .map((id) => (isRemoteUserId(id) ? id : f.identity.actorUrl(id)));
}

/** ワールドを見る人のサーバーで確かめる（入る前の確認に使う。確かめられなければ作者を確認できないワールドとして扱う）。 */
async function checkedWorld(url: string) {
    const resolved = await Promise.race([
        worldRegistry.resolveRef(url).catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000).unref()),
    ]);
    return resolved ?? undefined;
}

/** ほかのサーバーの部屋なら連合で答える（答えたら true）。 */
async function remoteInstance(req: Request, res: Response, id: string): Promise<boolean> {
    const address = federation?.remoteAddressOf(id);
    if (!federation || !address) return false;
    if (!req.user) {
        res.status(404).json({ error: TRAVEL_ERRORS['not-found'].error });
        return true;
    }
    const described = await federation.travel.describe(req.user.id, address, viaOf(req.query.via, federation));
    if (!described.ok) {
        const { status, error } = TRAVEL_ERRORS[described.error];
        res.status(status === 403 ? 404 : status).json({ error });
        return true;
    }
    const world = await checkedWorld(described.room.world.url);
    res.json(
        remoteInstanceOf(described.room, {
            address: id,
            domain: address.domain,
            canJoin: described.canJoin,
            world,
            seenAt: new Date(),
        }),
    );
    return true;
}

/**
 * GET /api/v1/instances
 * インスタンス一覧を取得（認証必須）
 */
router.get('/', optionalAuth, async (req, res) => {
    try {
        const queryResult = ListInstancesQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
            res.status(400).json({ error: 'Invalid query parameters', details: queryResult.error.issues });
            return;
        }

        const instances = await instanceManager.listInstances({
            tag: queryResult.data.tag,
            worldId: queryResult.data.worldId,
            includeFull: queryResult.data.includeFull,
            viewerId: req.user?.id ?? null,
        });

        res.json({ instances });
    } catch (error) {
        logger.error('インスタンス一覧取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const createInstanceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1時間
    limit: appConfig.rateLimit.instanceCreatePerHour, // 1IPあたり（既定 10 件）
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many instances created from this IP, please try again after an hour' },
    ...sharedRateLimit('instances-create', redis, logger),
});

/**
 * POST /api/v1/instances
 * 新しいインスタンスを作成（認証必須）
 */
router.post('/', requireAuth, createInstanceLimiter, async (req, res) => {
    try {
        const bodyResult = CreateInstanceRequestSchema.safeParse(req.body);
        if (!bodyResult.success) {
            res.status(400).json({ error: 'Invalid request body', details: bodyResult.error.issues });
            return;
        }

        // 認証されたユーザーIDを使用（requireAuthで保証）
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const leaderId = req.user.id;

        const result = await instanceManager.createInstance(bodyResult.data, leaderId);

        if ('error' in result) {
            res.status(400).json({ error: result.error });
            return;
        }

        res.status(201).json(result);
    } catch (error) {
        logger.error('インスタンス作成エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/v1/instances/:id
 * インスタンス詳細を取得（認証必須）
 */
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const id = req.params.id as string;
        if (await remoteInstance(req, res, id)) return;
        // 公開範囲で入れない人には、インスタンスがあることも伏せる
        const instance = await instanceManager.getInstanceFor(id, req.user?.id ?? null);

        if (!instance) {
            res.status(404).json({
                error: 'インスタンスが見つからないか、入れる人が限られています（フレンドのみなど）',
            });
            return;
        }

        res.json(instance);
    } catch (error) {
        logger.error('インスタンス取得エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/** SNSの認証・公開範囲を確認し、インスタンスへの接続情報を返す。 */
router.post('/:id/join', requireAuth, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const id = String(req.params.id);
    const address = federation?.remoteAddressOf(id);
    if (federation && address) {
        // ホームとして部屋のサーバーに頼み、ブラウザの origin に結び付いたチケットを受け取る
        const joined = await federation.travel
            .join(req.user.id, address, clientOriginOf(req, federation), viaOf(req.body?.via, federation))
            .catch((error: unknown) => {
                logger.error('ほかのサーバーの部屋に入れません:', error);
                return { ok: false as const, error: 'unavailable' as const };
            });
        if (!joined.ok) {
            const { status, error } = TRAVEL_ERRORS[joined.error];
            return res.status(status).json({ error });
        }
        return res.json(joined.grant);
    }
    // このサーバーの部屋に入るなら、ほかのサーバーへの来訪は終わり
    if (federation) void federation.travel.leave(req.user.id).catch(() => undefined);
    try {
        return res.json(await instanceManager.join(String(req.params.id), { id: req.user.id, name: req.user.name }));
    } catch (error) {
        if (error instanceof InstanceJoinRejected) return res.status(403).json({ error: error.message });
        logger.error('インスタンス参加エラー:', error);
        return res.status(503).json({ error: 'インスタンスに接続できません' });
    }
});

/**
 * 来訪を続けている（ほかのサーバーの部屋にいる間、画面から 30 秒ごと）。フレンドの現在地の答えに使う。
 * DELETE で来訪をやめる（部屋を出た）。
 */
router.post('/:id/visit', requireAuth, async (req, res) => {
    if (!req.user || !federation) return res.status(404).json({ error: 'Not found' });
    const id = String(req.params.id);
    const visit = await federation.visitOf(req.user.id);
    if (visit && federation.identity.roomAddressOf(visit.roomUrl) === id) {
        await federation.travel.heartbeat(req.user.id, visit.roomUrl);
        return res.status(204).send();
    }
    // 記録が途切れていた（通信が戻った）: 部屋のサーバーに尋ね直して記録し直す
    const address = federation.remoteAddressOf(id);
    const resumed = address && (await federation.travel.resume(req.user.id, address).catch(() => false));
    if (!resumed) return res.status(404).json({ error: 'この部屋への来訪の記録がありません' });
    return res.status(204).send();
});

router.delete('/:id/visit', requireAuth, async (req, res) => {
    if (!req.user || !federation) return res.status(204).send();
    const visit = await federation.visitOf(req.user.id);
    if (visit && federation.identity.roomAddressOf(visit.roomUrl) === String(req.params.id)) {
        await federation.travel.leave(req.user.id, visit.roomUrl);
    }
    return res.status(204).send();
});

/**
 * DELETE /api/v1/instances/:id
 * インスタンスを終了（認証必須）
 */
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id as string;
        // 認証されたユーザーIDを使用（requireAuthで保証）
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const userId = req.user.id;

        const result = await instanceManager.closeInstance(id, userId);

        if (!result.success) {
            const status = { 'not-found': 404, forbidden: 403, 'runtime-unavailable': 503, 'delete-failed': 500 }[
                result.reason
            ];
            res.status(status).json({ error: result.error });
            return;
        }

        res.status(204).send();
    } catch (error) {
        logger.error('インスタンス削除エラー:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export { router };
