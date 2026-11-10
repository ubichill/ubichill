/** 公開した作品の実体（DB・ワールドの解決・外部の作品の確認をつなぐ）。条件は publishedWorks.ts。 */
import { worldRepository } from '@ubichill/db';
import { selfAccount } from '../authors/authorKeys';
import { publishedExternalEntries } from './externalWorkStore';
import { createPublishedWorks } from './publishedWorks';
import { worldRegistry } from './worldRegistry';

export const publishedWorks = createPublishedWorks({
    worldsByAuthor: (userId) => worldRepository.findByAuthorId(userId),
    getWorld: (worldId) => worldRegistry.getWorld(worldId),
    repositoryWorldsByAuthor: (accounts) => worldRegistry.repositoryWorldsByAuthor(accounts),
    externalEntries: publishedExternalEntries,
    accountOf: selfAccount,
});
