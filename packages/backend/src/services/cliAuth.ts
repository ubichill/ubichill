/**
 * CLI・CI の認可（`ubichill login` / `ubichill ci create`）の判定。DB・時計・ハッシュは注入する。
 * 手順は docs/design/author-publishing.md §9。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
    API_TOKEN_PREFIX,
    type CliAuthRequestInput,
    isLoopbackRedirectUri,
    USER_CODE_ALPHABET,
} from '@ubichill/shared';

export const sha256Base64Url = (value: string): string => createHash('sha256').update(value).digest('base64url');

/** 推測できない値（要求 ID・デバイスコード・認可コード・トークン）。 */
export const randomSecret = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const newApiToken = (): string => `${API_TOKEN_PREFIX}${randomSecret(32)}`;

/** 画面で照合する短いコード（XXXX-XXXX、20 文字から 8 文字で約 34 bit）。 */
export function newUserCode(pick: (max: number) => number = randomInt): string {
    const chars = Array.from({ length: 8 }, () => USER_CODE_ALPHABET[pick(USER_CODE_ALPHABET.length)]);
    return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** 要求の方式。ループバックはリダイレクト先と PKCE が組で必要、デバイス認可はどちらも無し。 */
export function requestFlowOf(input: CliAuthRequestInput): 'loopback' | 'device' | { error: string } {
    const hasRedirect = input.redirectUri !== undefined;
    const hasChallenge = input.codeChallenge !== undefined;
    if (!hasRedirect && !hasChallenge) return 'device';
    if (!hasRedirect || !hasChallenge) return { error: 'redirectUri と codeChallenge は組で指定してください' };
    if (!isLoopbackRedirectUri(input.redirectUri ?? '')) {
        return { error: 'redirectUri は http://127.0.0.1:<port>/… か http://localhost:<port>/… に限ります' };
    }
    return 'loopback';
}

export interface StoredRequest {
    status: string;
    expiresAt: Date;
    codeChallenge: string | null;
    authCodeHash: string | null;
    deviceCodeHash: string | null;
}

export type ExchangeInput = { code: string; codeVerifier: string } | { deviceCode: string };

export type ExchangeOutcome = { ok: true } | { ok: false; status: 400 | 404 | 409 | 428; code: string; error: string };

/**
 * 引き換えてよいか（鍵の所有の証明は別に確かめる）。
 * - 失効・存在しない → 404、承認待ち → 428（デバイス認可のポーリングは待ち続ける）、引き換え済み → 409
 * - ループバックは認可コードと PKCE（S256）の両方、デバイス認可はデバイスコードが一致したときだけ
 */
export function exchangeOutcome(
    request: StoredRequest | undefined,
    input: ExchangeInput,
    now: Date,
    hash: (value: string) => string = sha256Base64Url,
): ExchangeOutcome {
    if (!request || request.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, status: 404, code: 'expired', error: '認可の要求が見つからないか、期限が切れています' };
    }
    if (request.status === 'consumed') {
        return { ok: false, status: 409, code: 'consumed', error: 'この認可の要求は引き換え済みです' };
    }
    const invalid = { ok: false, status: 400, code: 'invalid-grant', error: '認可コードが一致しません' } as const;
    if ('deviceCode' in input) {
        if (!request.deviceCodeHash || hash(input.deviceCode) !== request.deviceCodeHash) return invalid;
        if (request.status !== 'approved') {
            return { ok: false, status: 428, code: 'authorization-pending', error: 'まだ承認されていません' };
        }
        return { ok: true };
    }
    if (request.status !== 'approved' || !request.authCodeHash || !request.codeChallenge) return invalid;
    if (hash(input.code) !== request.authCodeHash) return invalid;
    if (hash(input.codeVerifier) !== request.codeChallenge) return invalid;
    return { ok: true };
}

/** 承認後のリダイレクト先（認可コードと CLI が付けた state を付ける）。 */
export function loopbackRedirect(redirectUri: string, code: string, state: string | undefined): string {
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    return url.href;
}

/** Authorization ヘッダーから API トークンを取り出す（形式が違えば undefined）。 */
export function bearerToken(header: string | undefined): string | undefined {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
    const token = m?.[1];
    return token?.startsWith(API_TOKEN_PREFIX) ? token : undefined;
}
