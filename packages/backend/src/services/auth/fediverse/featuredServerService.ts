/** 本番の DB・ログインの判定につないだ「並べるサーバー」の管理。規則は featuredServers.ts。 */
import { featuredServerRepository } from '@ubichill/db';
import { MAX_FEATURED_FEDIVERSE_SERVERS } from '@ubichill/shared';
import { lookupFediverseServerInfo } from '../../../lib/auth';
import { featuredServerList } from './featuredServerList';
import { createFeaturedServers } from './featuredServers';

export const featuredServerService = createFeaturedServers({
    repository: featuredServerRepository,
    lookup: lookupFediverseServerInfo,
    changed: () => featuredServerList.changed(),
    max: MAX_FEATURED_FEDIVERSE_SERVERS,
});
