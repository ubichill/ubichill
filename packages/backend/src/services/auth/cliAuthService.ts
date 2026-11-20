/** CLI・CI の認可の実体（DB・公開環境・鍵の確認をつなぐ）。規則と手順は cliAuth.ts。 */
import { cliAuthRequestRepository, userRepository } from '@ubichill/db';
import { verifyCliAuthProof } from '@ubichill/shared';
import { selfAccount } from '../authors/authorKeys';
import { publishingEnvironmentService } from '../authors/publishingEnvironmentService';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { createCliAuth, newApiToken, newUserCode, randomSecret, sha256Base64Url } from './cliAuth';

export const cliAuthService = createCliAuth({
    requests: cliAuthRequestRepository,
    findUser: (id) => userRepository.findById(id),
    environments: publishingEnvironmentService,
    verifyProof: (request, signature) => verifyCliAuthProof(request, signature, nodeWorldCrypto),
    accountOf: selfAccount,
    secrets: { random: randomSecret, userCode: () => newUserCode(), apiToken: newApiToken },
    hash: sha256Base64Url,
    now: () => new Date(),
});
