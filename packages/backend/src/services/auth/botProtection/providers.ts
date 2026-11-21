/**
 * ボット対策のサービス（Turnstile・hCaptcha）ごとの検証 API の違い。どちらもフォームで送り、同じ形の JSON を返す。
 * - Turnstile: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 * - hCaptcha: https://docs.hcaptcha.com/#verify-the-user-response-server-side
 */
import type { BotProtectionProvider } from '@ubichill/shared';

/** 検証 API の応答のうち、使う分。 */
export interface SiteVerifyResult {
    success: boolean;
    /** 確かめたページのホスト名 */
    hostname: string | null;
    /** 画面で渡した action（返すのは Turnstile だけ。hCaptcha は null） */
    action: string | null;
    /** テスト用の鍵だった（いつも通る・落ちる鍵。ホスト名も決まった値になる） */
    testing: boolean;
    errorCodes: string[];
}

export interface SiteVerifyInput {
    secret: string;
    token: string;
    siteKey: string;
    remoteIp: string | undefined;
}

interface ProviderSpec {
    url: string;
    form(input: SiteVerifyInput): URLSearchParams;
    /** action を必ず照合するか（Turnstile はトークンに入れて返す） */
    checksAction: boolean;
    testing(body: Record<string, unknown>, input: SiteVerifyInput): boolean;
}

/** hCaptcha が公開しているテスト用のシークレットキー */
const HCAPTCHA_TEST_SECRET = '0x0000000000000000000000000000000000000000';

const SPECS: Readonly<Record<BotProtectionProvider, ProviderSpec>> = {
    turnstile: {
        url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        form: ({ secret, token, remoteIp }) =>
            new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
        checksAction: true,
        testing: (body) =>
            typeof body.metadata === 'object' &&
            body.metadata !== null &&
            (body.metadata as Record<string, unknown>).result_with_testing_key === true,
    },
    hcaptcha: {
        url: 'https://api.hcaptcha.com/siteverify',
        form: ({ secret, token, siteKey, remoteIp }) =>
            new URLSearchParams({
                secret,
                response: token,
                sitekey: siteKey,
                ...(remoteIp ? { remoteip: remoteIp } : {}),
            }),
        checksAction: false,
        testing: (_body, input) => input.secret === HCAPTCHA_TEST_SECRET,
    },
};

export const siteVerifyRequest = (
    provider: BotProtectionProvider,
    input: SiteVerifyInput,
): { url: string; body: URLSearchParams } => ({ url: SPECS[provider].url, body: SPECS[provider].form(input) });

/** 検証 API の応答を読む。形が違えば失敗として扱う。 */
export function parseSiteVerify(
    provider: BotProtectionProvider,
    body: unknown,
    input: SiteVerifyInput,
): SiteVerifyResult {
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    const codes = record['error-codes'];
    return {
        success: record.success === true,
        hostname: text(record.hostname),
        action: text(record.action),
        testing: SPECS[provider].testing(record, input),
        errorCodes: Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [],
    };
}

/** 確かめた結果の判定。`hostname` はホスト名が違ったときに、どこで確かめたかを添える。 */
export type BotCheckVerdict =
    | { ok: true }
    | { ok: false; reason: 'failed' | 'misconfigured' | 'unavailable' | 'testing-key' | 'wrong-action' }
    | { ok: false; reason: 'wrong-hostname'; hostname: string | null };

/** 鍵の側の誤り（シークレットキーが違う・サイトキーと組でない）。利用者が何度やり直しても通らない */
const KEY_ERRORS = new Set([
    'missing-input-secret',
    'invalid-input-secret',
    'invalid-parsed-secret',
    'sitekey-secret-mismatch',
    'invalid-sitekey',
]);

export interface BotCheckExpectation {
    action: string;
    /** Ubichill の公開 URL のホスト名 */
    hostnames: ReadonlySet<string>;
    /** テスト用の鍵を通すか（本番以外だけ） */
    allowTestingKeys: boolean;
}

export function judgeSiteVerify(
    provider: BotProtectionProvider,
    result: SiteVerifyResult,
    expected: BotCheckExpectation,
): BotCheckVerdict {
    if (result.errorCodes.some((code) => KEY_ERRORS.has(code))) return { ok: false, reason: 'misconfigured' };
    if (result.errorCodes.includes('internal-error')) return { ok: false, reason: 'unavailable' };
    if (!result.success) return { ok: false, reason: 'failed' };
    // テスト用の鍵はホスト名・action が決まった値なので照合できない。本番では通さない（ボットを止めない）
    if (result.testing) return expected.allowTestingKeys ? { ok: true } : { ok: false, reason: 'testing-key' };
    if (result.hostname === null || !expected.hostnames.has(result.hostname.toLowerCase())) {
        return { ok: false, reason: 'wrong-hostname', hostname: result.hostname };
    }
    if (SPECS[provider].checksAction && result.action !== expected.action) return { ok: false, reason: 'wrong-action' };
    return { ok: true };
}

/**
 * Ubichill の公開 URL（BETTER_AUTH_URL と CORS_ORIGIN）のホスト名。確かめたページがここにあるかを照合する。
 * `*` や URL でないものは除く。
 */
export function publicHostnames(urls: readonly string[]): ReadonlySet<string> {
    return new Set(
        urls.flatMap((url) => {
            try {
                return [new URL(url).hostname.toLowerCase()];
            } catch {
                return [];
            }
        }),
    );
}
