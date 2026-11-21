/** NodeInfo（ubichill のサーバーかの判別）。機能は Application actor の implements で告知する。 */
import { buildNodeInfo, nodeInfoLinks } from '@ubichill/shared';
import { Router } from 'express';
import type { Federation } from '../../services/federation';
import type { ServerInfoService } from '../../services/server/serverInfo';
import { logger } from '../../utils/logger';
import { perIpLimit } from './signed';

export function createNodeInfoRouters(
    federation: Federation,
    server: Pick<ServerInfoService, 'overview'>,
): { wellKnown: Router; document: Router } {
    const limit = perIpLimit('nodeinfo', 120);
    const wellKnown = Router();
    wellKnown.get('/', limit, (_req, res) => {
        res.set('Cache-Control', 'public, max-age=3600').json(nodeInfoLinks(federation.identity.origin));
    });
    const document = Router();
    document.get('/2.1', limit, async (_req, res) => {
        // 読めなくてもサーバーの判別（ソフトと連合の版）はできるよう、情報を除いて返す
        const overview = await server.overview().catch((error: unknown) => {
            logger.warn('NodeInfo: サーバーの情報を読めませんでした', error);
            return null;
        });
        res.set('Cache-Control', overview ? 'public, max-age=1800' : 'no-store')
            .type('application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"')
            .send(
                JSON.stringify(
                    buildNodeInfo({
                        version: process.env.COMMIT_HASH ?? 'unknown',
                        openRegistrations: overview?.registrationOpen ?? false,
                        users: overview?.stats.users,
                        server: overview?.info,
                    }),
                ),
            );
    });
    return { wellKnown, document };
}
