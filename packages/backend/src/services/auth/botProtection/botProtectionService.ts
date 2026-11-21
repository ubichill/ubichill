/**
 * 本番の DB・サーバーの秘密・検証 API につないだボット対策。規則は botProtection.ts。
 * 設定は登録のたびに DB を読まないよう 30 秒覚える。変えた backend はすぐ捨て、ほかの backend には知らせで捨てさせる。
 * シークレットキーはサーバーの秘密（BETTER_AUTH_SECRETS で入れ替えられる）から作った鍵で暗号化する。
 */
import { type BotProtectionRecord, botProtectionRepository } from '@ubichill/db';
import { ENV_KEYS } from '@ubichill/shared';
import { appConfig } from '../../../config';
import { auth } from '../../../lib/auth';
import { createSecretBox } from '../../../lib/secretBox';
import { serverKeysFrom } from '../../../lib/serverKeys';
import { logger } from '../../../utils/logger';
import { backendEvents } from '../../cluster/backendEvents';
import { type BotProtection, createBotProtection } from './botProtection';
import { parseSiteVerify, publicHostnames, siteVerifyRequest } from './providers';

const TTL_MS = 30_000;
const VERIFY_TIMEOUT_MS = 5_000;

const cache: { at: number; value: Promise<BotProtectionRecord | null> | null } = { at: 0, value: null };
const forget = () => {
    cache.value = null;
};
backendEvents.on('auth.bot-protection.changed', forget);

const cachedSettings = (): Promise<BotProtectionRecord | null> => {
    if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
    const value = botProtectionRepository.get();
    value.catch(forget);
    cache.at = Date.now();
    cache.value = value;
    return value;
};

// 未設定の値を既定の URL（localhost）で埋めない（本番で localhost のトークンを受け付けない）
const hostnames = publicHostnames([
    appConfig.auth.url,
    process.env[ENV_KEYS.PUBLIC_BASE_URL] ?? '',
    ...(Array.isArray(appConfig.cors.origin) ? appConfig.cors.origin : []),
]);

const ready: { value?: Promise<BotProtection> } = {};

const botProtection = (): Promise<BotProtection> => {
    ready.value ??= auth.$context.then((ctx) =>
        createBotProtection({
            cached: cachedSettings,
            repository: botProtectionRepository,
            box: createSecretBox(serverKeysFrom(ctx.secretConfig), 'bot-protection/secret'),
            siteVerify: async (provider, input) => {
                const request = siteVerifyRequest(provider, input);
                const res = await fetch(request.url, {
                    method: 'POST',
                    body: request.body,
                    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
                });
                if (!res.ok) throw new Error(`ボット対策の検証 API が ${res.status} を返した`);
                return parseSiteVerify(provider, await res.json(), input);
            },
            hostnames,
            allowTestingKeys: !appConfig.isProduction,
            changed: () => {
                forget();
                backendEvents.broadcast({ type: 'auth.bot-protection.changed' });
            },
            warn: (message) => logger.warn(message),
        }),
    );
    return ready.value;
};

export const botProtectionService: BotProtection = {
    config: async () => (await botProtection()).config(),
    check: async (input) => (await botProtection()).check(input),
    settings: async () => (await botProtection()).settings(),
    update: async (input) => (await botProtection()).update(input),
};
