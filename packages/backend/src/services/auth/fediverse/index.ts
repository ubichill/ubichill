/** 本番の依存（safeFetch・DB・設定）につないだフェディバースのログイン。 */
import { randomBytes } from 'node:crypto';
import { authFlowRepository, domainPolicyRepository, fediverseAccountRepository } from '@ubichill/db';
import { DisplayNameSchema, type DomainRestriction, HandleSchema, policyFor } from '@ubichill/shared';
import { appConfig } from '../../../config';
import { safeFetch } from '../../../lib/safeFetch';
import { logger } from '../../../utils/logger';
import { type FediverseHttp, HttpStatusError } from './protocol';
import { createFediverseSignIn } from './signIn';

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

async function isBlocked(host: string): Promise<boolean> {
    const hostname = host.replace(/:\d+$/, '');
    const restrictions = new Map<string, DomainRestriction>(
        (await domainPolicyRepository.list()).flatMap((r) =>
            r.policy === 'block' || r.policy === 'limit' ? [[r.domain.toLowerCase(), r.policy]] : [],
        ),
    );
    return policyFor(hostname, restrictions) === 'block';
}

const corsOrigins = appConfig.cors.origin;
const defaultAppOrigin =
    (Array.isArray(corsOrigins) ? corsOrigins[0] : undefined) ?? process.env.PUBLIC_BASE_URL ?? appConfig.auth.url;

function isAppOrigin(origin: string): boolean {
    if (corsOrigins === '*') return /^https?:\/\/[^/]+$/.test(origin);
    return corsOrigins.includes(origin);
}

/**
 * better-auth の ID の作り方（auth.$context の generateId）は auth.ts が初期化した後に渡す
 * （ここから auth.ts を読むと循環する）。
 */
export function createProductionFediverseSignIn(newId: (model: 'user' | 'account') => string) {
    return createFediverseSignIn({
        config: {
            enabled: appConfig.fediverseSignIn.enabled,
            allowedServers: appConfig.fediverseSignIn.allowedServers,
            authBaseUrl: `${appConfig.auth.url.replace(/\/+$/, '')}/api/auth`,
            website: process.env.PUBLIC_BASE_URL || defaultAppOrigin,
            defaultAppOrigin,
        },
        isAppOrigin,
        isBlocked,
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
        validate: { handle: HandleSchema, displayName: DisplayNameSchema },
        newId,
        random: () => randomBytes(32).toString('base64url'),
        now: () => new Date(),
        warn: (message, error) => logger.warn(message, error),
    });
}
