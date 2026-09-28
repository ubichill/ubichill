/** 公式アカウントの初期化の実体（better-auth・DB・レビュー済みの鍵を注入する）。ロジックは officialAccount.ts。 */
import { userRepository } from '@ubichill/db';
import { OFFICIAL_WORLDS_AUTHOR } from '@ubichill/shared';
import { auth } from '../lib/auth';
import { pinnedAuthorKey } from './authorKeyStore';
import { ensureOfficialAccount, officialAccountConfig } from './officialAccount';

export async function bootstrapOfficialAccount(): Promise<void> {
    const ctx = await auth.$context;
    await ensureOfficialAccount(officialAccountConfig(process.env), {
        findByHandle: (handle) => userRepository.findByHandle(handle),
        findByEmail: (email) => userRepository.findByEmail(email),
        signUp: async (email, password, name) => {
            const result = await auth.api.signUpEmail({ body: { email, password, name } });
            return result.user.id;
        },
        passwordMatches: async (userId, password) => {
            const hash = await userRepository.findPasswordHash(userId);
            return hash ? ctx.password.verify({ hash, password }) : false;
        },
        replacePassword: async (userId, password) => {
            await userRepository.setPasswordHash(userId, await ctx.password.hash(password));
            await userRepository.revokeSessions(userId);
        },
        isDisplayNameTaken: async (key) => !!(await userRepository.findByDisplayNameKey(key)),
        initialize: (id, fields) => userRepository.initializeAccount(id, fields),
        officialPublicKey: pinnedAuthorKey(OFFICIAL_WORLDS_AUTHOR),
        log: (message) => console.log(message),
    });
}
