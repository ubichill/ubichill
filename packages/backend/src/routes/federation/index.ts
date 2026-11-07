/**
 * 連合のルートをアプリに付ける。ほかのサーバーからの要求（`/ap`・`/federation`・NodeInfo）は本文を生のまま受け
 * （署名の Content-Digest を確かめるため）、IP ごとの全体の上限から外して、署名したサーバーごとに絞る。
 */
import { FEDERATION_LIMITS } from '@ubichill/shared';
import express, { type Express } from 'express';
import { federation } from '../../services/federation';
import { createActivityPubRouter } from './activitypub';
import { createFederationAdminRouter } from './admin';
import { createNodeInfoRouters } from './nodeinfo';
import { router as peersRouter } from './peers';
import { createRpcRouter } from './rpc';

/** ほかのサーバーからの要求のパス（全体の上限から外す）。 */
export const FEDERATION_INBOUND_PATHS = ['/ap/', '/federation/', '/.well-known/nodeinfo', '/nodeinfo/'];

export const isFederationInboundPath = (path: string): boolean =>
    FEDERATION_INBOUND_PATHS.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p));

/** express.json より前に付ける（生の本文を受ける口）。 */
export function mountFederationInbound(app: Express): void {
    if (!federation) return;
    const raw = express.raw({ type: () => true, limit: FEDERATION_LIMITS.INBOX_BODY_BYTES });
    app.use('/ap', raw, createActivityPubRouter(federation));
    app.use('/federation/v1', raw, createRpcRouter(federation));
    const nodeinfo = createNodeInfoRouters(federation);
    app.use('/.well-known/nodeinfo', nodeinfo.wellKnown);
    app.use('/nodeinfo', nodeinfo.document);
}

/** 画面から使う連合の API（`/api/v1/federation`）。 */
export const federationApiRouter = (() => {
    const router = createFederationAdminRouter(federation);
    router.use(peersRouter);
    return router;
})();
