/** 公式アカウントの初期化の実体（better-auth・DB・レビュー済みの鍵を注入する）。ロジックは officialAccount.ts。 */
import { publishingEnvironmentRepository, userRepository } from '@ubichill/db';
import { OFFICIAL_WORLDS_AUTHOR } from '@ubichill/shared';
import { auth } from '../lib/auth';
import { pinnedAuthorKeys } from './authorKeyStore';
import { ensureOfficialAccount, officialAccountConfig } from './officialAccount';
import { officialKeyChanges } from './publishingEnvironments';

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
        syncSigningKeys: async (userId) => {
            const { add, revoke } = officialKeyChanges(
                pinnedAuthorKeys(OFFICIAL_WORLDS_AUTHOR),
                await publishingEnvironmentRepository.listByUser(userId),
            );
            for (const publicKey of add) {
                if (await publishingEnvironmentRepository.findByPublicKey(publicKey)) {
                    console.warn('⚠ 公式の鍵が別のアカウントに登録されているため、公式アカウントに登録しません');
                    continue;
                }
                await publishingEnvironmentRepository.create({
                    userId,
                    kind: 'cli',
                    name: '公式ワールドの署名鍵（trusted-authors.json）',
                    publicKey,
                });
            }
            for (const id of revoke) await publishingEnvironmentRepository.revoke(userId, id, 'compromised');
        },
        log: (message) => console.log(message),
    });
}
