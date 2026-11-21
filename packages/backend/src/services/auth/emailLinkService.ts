/** 本番の DB・better-auth・メールにつないだメールアドレスの追加。規則と手順は emailLinks.ts。 */
import { emailLinkRepository, fediverseAccountRepository, userRepository } from '@ubichill/db';
import { appConfig } from '../../config';
import { auth, generateOTP, newBetterAuthId, sendEmailLinkCode } from '../../lib/auth';
import { createEmailLinks, type EmailLinks } from './emailLinks';
import { createOtpHasher } from './pendingRegistrations';

const ready: { links?: Promise<EmailLinks> } = {};

const emailLinks = (): Promise<EmailLinks> => {
    ready.links ??= auth.$context.then((ctx) =>
        createEmailLinks({
            repository: emailLinkRepository,
            user: async (userId) => {
                const user = await userRepository.findById(userId);
                return user && { email: user.email, hasPassword: await fediverseAccountRepository.hasPassword(userId) };
            },
            emailInUse: async (email) => !!(await userRepository.findByEmail(email)),
            password: {
                hash: (password) => ctx.password.hash(password),
                minLength: ctx.password.config.minPasswordLength,
                maxLength: ctx.password.config.maxPasswordLength,
            },
            newOtp: generateOTP,
            hashOtp: createOtpHasher(ctx.secret),
            newAccountId: () => newBetterAuthId(ctx, 'account'),
            sendCode: sendEmailLinkCode,
            afterLinked: async (userId, sessionId) => {
                await userRepository.markSessionPasswordVerified(userId, sessionId, new Date());
            },
            skipVerification: appConfig.email.skipVerification,
            now: () => new Date(),
        }),
    );
    return ready.links;
};

export const emailLinkService = {
    start: async (input: Parameters<EmailLinks['start']>[0]) => (await emailLinks()).start(input),
    verify: async (input: Parameters<EmailLinks['verify']>[0]) => (await emailLinks()).verify(input),
    deleteExpired: () => emailLinkRepository.deleteExpired(),
};
