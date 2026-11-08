/**
 * 連合の設定と状態（`/api/v1/federation`。画面から使う）。
 * - `GET /`: 連合しているか・このサーバーのドメイン（誰でも）
 * - `GET /policies`・`PUT /policies/:domain`・`DELETE /policies/:domain`: ほかのサーバーとの付き合い方（管理者）
 *   block にしたら、そのドメインの人とのフレンドも切る
 * - `GET /servers`: 知っているほかのサーバーと配送の調子（管理者）
 */
import { domainPolicyRepository, remoteServerRepository } from '@ubichill/db';
import { isServerDomain } from '@ubichill/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../middleware/auth';
import { domainPolicyChanged, type Federation } from '../../services/federation';

const PolicyBodySchema = z
    .object({ policy: z.enum(['limit', 'block']), reason: z.string().trim().max(200).optional() })
    .strict();

export function createFederationAdminRouter(federation: Federation | null): Router {
    const router = Router();

    router.get('/', (_req, res) => {
        res.json({ enabled: federation !== null, domain: federation?.identity.domain ?? null });
    });

    router.get('/policies', requireAuth, requireAdmin, async (_req, res) => {
        res.set('Cache-Control', 'no-store').json({ policies: await domainPolicyRepository.list() });
    });

    router.put('/policies/:domain', requireAuth, requireAdmin, async (req, res) => {
        const domain = String(req.params.domain).toLowerCase();
        const parsed = PolicyBodySchema.safeParse(req.body);
        if (!isServerDomain(domain) || !parsed.success)
            return void res.status(400).json({ error: 'ドメインか方針が正しくありません' });
        if (domain === federation?.identity.domain)
            return void res.status(400).json({ error: 'このサーバーには決められません' });
        await domainPolicyRepository.set({
            domain,
            policy: parsed.data.policy,
            reason: parsed.data.reason || null,
            createdBy: req.user?.id ?? null,
        });
        await domainPolicyChanged(domain, parsed.data.policy);
        res.status(204).send();
    });

    router.delete('/policies/:domain', requireAuth, requireAdmin, async (req, res) => {
        const domain = String(req.params.domain).toLowerCase();
        const removed = await domainPolicyRepository.remove(domain);
        if (!removed) return void res.status(404).json({ error: '決めた方針がありません' });
        await domainPolicyChanged(domain, null);
        res.status(204).send();
    });

    router.get('/servers', requireAuth, requireAdmin, async (_req, res) => {
        const servers = await remoteServerRepository.list();
        res.set('Cache-Control', 'no-store').json({
            servers: servers.map((s) => ({
                domain: s.domain,
                software: s.software,
                version: s.version,
                federationVersion: s.federationVersion,
                firstSeenAt: s.firstSeenAt.toISOString(),
                lastSeenAt: s.lastSeenAt.toISOString(),
                lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
                failingSince: s.failingSince?.toISOString() ?? null,
                pausedUntil: s.pausedUntil?.toISOString() ?? null,
                policy: federation?.policies.policyOf(s.domain) ?? 'allow',
            })),
        });
    });

    return router;
}
