/**
 * 本番の DB・サーバーの秘密につないだ二段階認証。規則と手順は twoFactor.ts・challenges.ts。
 * サーバーの秘密（auth.$context の secret）と通知メールの送り方は auth.ts から渡す（ここから auth.ts を読むと循環する）。
 */
import { createHmac, randomBytes } from 'node:crypto';
import { twoFactorChallengeRepository, twoFactorRepository, userRepository } from '@ubichill/db';
import { appConfig } from '../../../config';
import { createSecretBox } from '../../../lib/secretBox';
import { logger } from '../../../utils/logger';
import { randomSecret, sha256Base64Url } from '../cliAuth';
import { createTwoFactorChallenges } from './challenges';
import { createTwoFactor } from './twoFactor';

type Notify = (user: { email: string; emailVerified: boolean }, subject: string, text: string) => Promise<void>;

/** 認証アプリに出すアカウント名のホスト（セルフホストのインスタンスを見分けられるように） */
const accountHost = (): string => {
    try {
        return new URL(process.env.PUBLIC_BASE_URL || appConfig.auth.url).host;
    } catch {
        return 'ubichill';
    }
};

export function createProductionTwoFactor(serverSecret: string, notify: Notify) {
    const twoFactor = createTwoFactor({
        repository: twoFactorRepository,
        box: createSecretBox(serverSecret, 'two-factor/totp-secret'),
        hashBackupCode: (userId, code) =>
            createHmac('sha256', serverSecret)
                .update(`ubichill/two-factor/backup-code\n${userId}\n${code}`)
                .digest('base64url'),
        randomBytes: (size) => new Uint8Array(randomBytes(size)),
        label: async (userId) => {
            const user = await userRepository.findById(userId);
            return user ? { issuer: 'Ubichill', account: `@${user.handle}@${accountHost()}` } : null;
        },
        notify: async (userId, subject, text) => {
            const user = await userRepository.findById(userId);
            if (user) await notify(user, subject, `${user.name} さん\n\n${text}`);
        },
        warn: (message) => logger.warn(message),
        now: () => new Date(),
    });
    const challenges = createTwoFactorChallenges({
        repository: twoFactorChallengeRepository,
        verify: (userId, code) => twoFactor.verifyForSignIn(userId, code),
        newToken: () => randomSecret(32),
        hashToken: sha256Base64Url,
        now: () => new Date(),
        lockedError: twoFactor.lockedError,
    });
    return { twoFactor, challenges };
}

export type ProductionTwoFactor = ReturnType<typeof createProductionTwoFactor>;
