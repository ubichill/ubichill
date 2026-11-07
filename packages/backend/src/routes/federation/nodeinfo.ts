/** NodeInfo（ubichill のサーバーかの判別）。機能は Application actor の implements で告知する。 */
import { buildNodeInfo, nodeInfoLinks } from '@ubichill/shared';
import { Router } from 'express';
import type { Federation } from '../../services/federation';
import { perIpLimit } from './signed';

export function createNodeInfoRouters(federation: Federation): { wellKnown: Router; document: Router } {
    const limit = perIpLimit('nodeinfo', 120);
    const wellKnown = Router();
    wellKnown.get('/', limit, (_req, res) => {
        res.set('Cache-Control', 'public, max-age=3600').json(nodeInfoLinks(federation.identity.origin));
    });
    const document = Router();
    document.get('/2.1', limit, (_req, res) => {
        res.set('Cache-Control', 'public, max-age=1800')
            .type('application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"')
            .send(
                JSON.stringify(
                    buildNodeInfo({ version: process.env.COMMIT_HASH ?? 'unknown', openRegistrations: true }),
                ),
            );
    });
    return { wellKnown, document };
}
