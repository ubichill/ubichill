/** 公開環境の実体（DB・メール・ワールドのキャッシュをつなぐ）。規則と手順は publishingEnvironments.ts。 */
import { authorKeyRepository, userRepository } from '@ubichill/db';
import { ENV_KEYS, SERVER_CONFIG, verifyKeyRegistration } from '@ubichill/shared';
import { sendAccountNotice } from '../../lib/auth';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { worldRegistry } from '../worlds/worldRegistry';
import { selfAccount } from './authorKeys';
import { createPublishingEnvironments } from './publishingEnvironments';

export type { RegisterEnvironmentOutcome } from './publishingEnvironments';

export const publishingEnvironmentService = createPublishingEnvironments({
    keys: authorKeyRepository,
    findUser: (id) => userRepository.findById(id),
    findUserByHandle: (handle) => userRepository.findByHandle(handle),
    accountOf: selfAccount,
    verifyRegistration: (claim, signature) => verifyKeyRegistration(claim, signature, Date.now(), nodeWorldCrypto),
    keysChanged: () => worldRegistry.invalidateResolvedWorlds(),
    notify: (owner, subject, text) => void sendAccountNotice(owner, subject, text),
    siteUrl: () => new URL('/', process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL).href,
    now: () => new Date(),
});
