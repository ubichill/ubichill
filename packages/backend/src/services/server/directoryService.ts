/** 本番の DB につないだ、検索に出してよい人の ID。規則は directory.ts。 */
import { userRepository } from '@ubichill/db';
import { isIndexableEnvironment } from '@ubichill/shared';
import { appConfig } from '../../config';
import { createDirectory } from './directory';

export const directoryService = createDirectory({
    listHandles: (limit) => userRepository.listDiscoverableHandles(limit),
    indexable: isIndexableEnvironment(appConfig.nodeEnv),
    // sitemap 1 つは 5 万件まで。ワールドと合わせても収まる数にする
    limit: 10_000,
    ttlMs: 10 * 60 * 1000,
});
