/** 本番の依存（safeFetch・DB・設定）につないだフェディバースのログイン。 */
import { randomBytes } from 'node:crypto';
import {
    accountDeletionRepository,
    authFlowRepository,
    domainPolicyRepository,
    fediverseAccountRepository,
    userRepository,
} from '@ubichill/db';
import {
    DisplayNameSchema,
    type DomainRestriction,
    HandleSchema,
    OFFICIAL_HANDLE,
    PROFILE_IMAGE_MAX_BYTES,
    policyFor,
} from '@ubichill/shared';
import { appConfig } from '../../../config';
import { safeFetch } from '../../../lib/safeFetch';
import { logger } from '../../../utils/logger';
import { profileService } from '../../profiles/profileService';
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

const BLOCKED_HOSTS_TTL_MS = 10_000;
const blockedHostsCache: { at: number; value: Promise<(host: string) => boolean> | null } = { at: 0, value: null };

/**
 * 連合で block にしたドメインか、を引く関数（一度読んだ方針で答える。ロック中にも使える）。
 * 入力の確認のたびに表を全部読まないよう 10 秒だけ覚える（方針を変えたら forgetBlockedHosts で捨てる）。
 */
function loadBlockedHosts(): Promise<(host: string) => boolean> {
    if (blockedHostsCache.value && Date.now() - blockedHostsCache.at < BLOCKED_HOSTS_TTL_MS) {
        return blockedHostsCache.value;
    }
    const value = domainPolicyRepository.list().then((rows) => {
        const restrictions = new Map<string, DomainRestriction>(
            rows.flatMap((r) =>
                r.policy === 'block' || r.policy === 'limit' ? [[r.domain.toLowerCase(), r.policy]] : [],
            ),
        );
        return (host: string) => policyFor(host.replace(/:\d+$/, ''), restrictions) === 'block';
    });
    value.catch(() => {
        blockedHostsCache.value = null;
    });
    blockedHostsCache.at = Date.now();
    blockedHostsCache.value = value;
    return value;
}

/** 連合のドメインの方針を変えたとき。覚えた方針を捨て、使えなくなったサーバーで入ったセッションを消す。 */
export async function fediverseLoginPolicyChanged(): Promise<number> {
    blockedHostsCache.value = null;
    return fediverseAccountRepository.revokeSessionsOfUnusable(await loadLoginPolicy());
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
const defaultAppOrigin = new URL(
    (Array.isArray(corsOrigins) ? corsOrigins[0] : undefined) ?? process.env.PUBLIC_BASE_URL ?? appConfig.auth.url,
).origin;

/** 画面の origin として戻してよいか。CORS が `*`（開発の chart）のときは既定の origin だけ（任意の origin へ飛ばさない）。 */
function isAppOrigin(origin: string): boolean {
    if (corsOrigins === '*') return origin === defaultAppOrigin;
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
            // 開発・手元の確認だけ（WORLDS_FETCH_ALLOW_PRIVATE と同じ扱い）
            allowPorts: !appConfig.isProduction,
            signUpsPerServerPerHour: 30,
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
            isHandleRetired: (handle) => accountDeletionRepository.isHandleRetired(handle),
            ssoAllowedFor: async (userId) => (await userRepository.findById(userId))?.handle !== OFFICIAL_HANDLE,
            findUserByIdentity: (identity, now) => fediverseAccountRepository.findUserByIdentity(identity, now),
            createUser: (input) => fediverseAccountRepository.createUser(input),
            link: (input) => fediverseAccountRepository.link(input),
        },
        registrationOpen: () => appConfig.registrationOpen,
        importAvatar: async (userId, url) => {
            // 画像は外部の CDN にあることが多いので、リダイレクトは少しだけ追う（資格情報は送らない）
            const res = await safeFetch(url, { maxRedirects: 2, maxBytes: PROFILE_IMAGE_MAX_BYTES });
            if (!res.ok) throw new HttpStatusError(res.status, url);
            const outcome = await profileService.replaceImage(
                userId,
                'avatar',
                new Uint8Array(await res.arrayBuffer()),
            );
            if (!outcome.ok) throw new Error(`アイコンを使えませんでした: ${outcome.error}`);
        },
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
