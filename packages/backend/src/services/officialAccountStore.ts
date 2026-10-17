/** 公式アカウントの初期化の実体（better-auth・DB・レビュー済みの鍵を注入する）。ロジックは officialAccount.ts。 */
import { authorKeyRepository, externalWorkRepository, userRepository, worldRepository } from '@ubichill/db';
import { auth, newBetterAuthId } from '../lib/auth';
import { ensureOfficialAccount, officialAccountConfig } from './officialAccount';

export async function bootstrapOfficialAccount(): Promise<void> {
    const ctx = await auth.$context;
    await ensureOfficialAccount(officialAccountConfig(process.env), {
        findByHandle: (handle) => userRepository.findByHandle(handle),
        findByEmail: (email) => userRepository.findByEmail(email),
        // signUpEmail は handle の無い users を先に作るので使わない（handle は NOT NULL）
        signUp: async ({ email, password, name, handle, displayNameKey }) => {
            const userId = newBetterAuthId(ctx, 'user');
            await userRepository.createCredentialUser({
                userId,
                accountId: newBetterAuthId(ctx, 'account'),
                email: email.toLowerCase(),
                name,
                handle,
                displayNameKey,
                passwordHash: await ctx.password.hash(password),
                now: new Date(),
            });
            return userId;
        },
        hasPublished: async (userId) => {
            const [keys, worlds, externalWorks] = await Promise.all([
                authorKeyRepository.listByUser(userId),
                worldRepository.findByAuthorId(userId),
                externalWorkRepository.countByUser(userId),
            ]);
            return keys.length > 0 || worlds.length > 0 || externalWorks > 0;
        },
        passwordMatches: async (userId, password) => {
            const hash = await userRepository.findPasswordHash(userId);
            return hash ? ctx.password.verify({ hash, password }) : false;
        },
        replacePassword: async (userId, password) => {
            await userRepository.setPasswordHash(userId, await ctx.password.hash(password));
            await userRepository.revokeSessions(userId);
        },
        revokeCredentials: async (userId) => {
            await userRepository.revokeSessions(userId);
            return authorKeyRepository.revokeAllForUser(userId, 'compromised');
        },
        isDisplayNameTaken: async (key) => !!(await userRepository.findByDisplayNameKey(key)),
        initialize: (id, fields) => userRepository.initializeAccount(id, fields),
        log: (message) => console.log(message),
    });
}
