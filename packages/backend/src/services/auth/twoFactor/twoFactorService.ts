/** 設定の「二段階認証」から使う口（本番の二段階認証は lib/auth.ts の getTwoFactor が作る）。 */
import { getTwoFactor } from '../../../lib/auth';

export const twoFactorService = {
    status: async (userId: string) => (await getTwoFactor()).twoFactor.status(userId),
    beginSetup: async (userId: string) => (await getTwoFactor()).twoFactor.beginSetup(userId),
    enable: async (userId: string, code: unknown) => (await getTwoFactor()).twoFactor.enable(userId, code),
    disable: async (userId: string, code: unknown) => (await getTwoFactor()).twoFactor.disable(userId, code),
    regenerateBackupCodes: async (userId: string, code: unknown) =>
        (await getTwoFactor()).twoFactor.regenerateBackupCodes(userId, code),
};
