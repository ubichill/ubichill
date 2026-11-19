/** 本番の依存（safeFetch・DB・設定）につないだフェディバースのログイン。 */
import { randomBytes } from 'node:crypto';
import { authFlowRepository, domainPolicyRepository, fediverseAccountRepository, userRepository } from '@ubichill/db';
import { DisplayNameSchema, type DomainRestriction, HandleSchema, policyFor } from '@ubichill/shared';
import { appConfig } from '../../../config';
import { safeFetch } from '../../../lib/safeFetch';
import { logger } from '../../../utils/logger';
import { createLoginPolicy } from './loginPolicy';
import { type FediverseHttp, HttpStatusError } from './protocol';
import { createFediverseSignIn } from './signIn';

/** 認証の途中の状態（verifications）の identifier の前置き。期限切れの掃除に使う。 */
export const FEDIVERSE_FLOW_PREFIX = 'fediverse-';

/** 資格情報を送るので、リダイレクトは追わない（3xx はそのまま失敗にする）。 */
const http: FediverseHttp = {
    async json(url, init) {
        const res = await safeFetch(url, { ...init, maxRedirects: 0 });
        if (!res.ok) {
            await res.body?.cancel();
            throw new HttpStatusError(res.status, url);
        }
        return res.json();
    },
};

/** 連合で block にしたドメインか、を引く関数（一度読んだ方針で答える。ロック中にも使える）。 */
async function loadBlockedHosts(): Promise<(host: string) => boolean> {
    const restrictions = new Map<string, DomainRestriction>(
        (await domainPolicyRepository.list()).flatMap((r) =>
            r.policy === 'block' || r.policy === 'limit' ? [[r.domain.toLowerCase(), r.policy]] : [],
        ),
    );
    return (host) => policyFor(host.replace(/:\d+$/, ''), restrictions) === 'block';
}

/** 今の設定でログインに使える手段か（providerId ごと）。 */
export async function loadLoginPolicy(): Promise<(providerId: string) => boolean> {
    return createLoginPolicy({
        fediverseEnabled: appConfig.fediverseSignIn.enabled,
        allowedServers: appConfig.fediverseSignIn.allowedServers,
        isBlocked: await loadBlockedHosts(),
    });
}

const corsOrigins = appConfig.cors.origin;
const defaultAppOrigin =
    (Array.isArray(corsOrigins) ? corsOrigins[0] : undefined) ?? process.env.PUBLIC_BASE_URL ?? appConfig.auth.url;

function isAppOrigin(origin: string): boolean {
    if (corsOrigins === '*') return /^https?:\/\/[^/]+$/.test(origin);
    return corsOrigins.includes(origin);
}

type Notify = (user: { email: string; emailVerified: boolean }, subject: string, text: string) => Promise<void>;

/**
 * better-auth の ID の作り方（auth.$context の generateId）と通知メールの送り方は auth.ts から渡す
 * （ここから auth.ts を読むと循環する）。
 */
export function createProductionFediverseSignIn(newId: (model: 'user' | 'account') => string, notify: Notify) {
    return createFediverseSignIn({
        config: {
            enabled: appConfig.fediverseSignIn.enabled,
            allowedServers: appConfig.fediverseSignIn.allowedServers,
            authBaseUrl: `${appConfig.auth.url.replace(/\/+$/, '')}/api/auth`,
            website: process.env.PUBLIC_BASE_URL || defaultAppOrigin,
            defaultAppOrigin,
        },
        isAppOrigin,
        isBlocked: async (host) => (await loadBlockedHosts())(host),
        http,
        clients: {
            find: (origin, redirectUri) => fediverseAccountRepository.findClient(origin, redirectUri),
            save: (input) => fediverseAccountRepository.saveClient(input),
            forget: (origin, redirectUri) => fediverseAccountRepository.forgetClient(origin, redirectUri),
        },
        flows: authFlowRepository,
        accounts: {
            findUserByIdentity: (identity, now) => fediverseAccountRepository.findUserByIdentity(identity, now),
            createUser: (input) => fediverseAccountRepository.createUser(input),
            link: (input) => fediverseAccountRepository.link(input),
        },
        registrationOpen: () => appConfig.registrationOpen,
        notifyLinked: async (userId, account) => {
            const user = await userRepository.findById(userId);
            if (!user) return;
            await notify(
                user,
                'ログイン方法が追加されました',
                `${user.name} さんのアカウントに、ログイン方法として ${account} が追加されました。\n\n` +
                    '心当たりが無い場合は、設定の「アカウント」でこのログイン方法を外し、パスワードを変更してください。',
            );
        },
        validate: { handle: HandleSchema, displayName: DisplayNameSchema },
        newId,
        random: () => randomBytes(32).toString('base64url'),
        now: () => new Date(),
        warn: (message, error) => logger.warn(message, error),
    });
}
