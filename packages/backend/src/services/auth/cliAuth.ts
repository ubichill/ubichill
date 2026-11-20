/**
 * CLI・CI の認可（`ubichill login` / `ubichill ci create`）の判定と手順。DB・時計・乱数は注入する（実体は cliAuthService.ts）。
 * 手順は docs/design/author-publishing.md §9。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
    API_TOKEN_PREFIX,
    CLI_AUTH_REQUEST_TTL_MS,
    type CliAuthRequestInput,
    isLoopbackRedirectUri,
    USER_CODE_ALPHABET,
} from '@ubichill/shared';
import type { KeyOwner, PublishingEnvironments, PublishingEnvironmentView } from '../authors/publishingEnvironments';

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

/** 保存した要求（DB の行のうち使うもの）。 */
export interface CliAuthRequestRow extends StoredRequest {
    id: string;
    kind: string;
    name: string;
    publicKey: string;
    redirectUri: string | null;
    userCode: string | null;
    /** 承認した人（承認されるまで null） */
    userId: string | null;
}

/** 承認画面に見せる要求の内容（秘密は返さない）。 */
export function cliAuthRequestView(r: CliAuthRequestRow) {
    return {
        id: r.id,
        kind: r.kind,
        name: r.name,
        publicKey: r.publicKey,
        flow: r.redirectUri ? ('loopback' as const) : ('device' as const),
        redirectHost: r.redirectUri ? new URL(r.redirectUri).host : null,
        userCode: r.userCode,
        status: r.status,
        expiresAt: r.expiresAt.toISOString(),
    };
}
export type CliAuthRequestView = ReturnType<typeof cliAuthRequestView>;

export interface CliAuthDeps {
    requests: {
        create(
            input: Omit<CliAuthRequestRow, 'status' | 'authCodeHash' | 'userId'> & { deviceCodeHash: string | null },
        ): Promise<unknown>;
        /** 失効していない要求 */
        findActive(id: string): Promise<CliAuthRequestRow | undefined>;
        findActiveByUserCode(userCode: string): Promise<CliAuthRequestRow | undefined>;
        /** 承認待ちのものだけ承認する。承認できなければ undefined */
        approve(id: string, userId: string, authCodeHash: string | null): Promise<object | undefined>;
        /** 承認済みのものを 1 回だけ引き換え済みにする。同時に来ても 1 つしか通らない */
        consume(id: string): Promise<object | undefined>;
    };
    findUser(id: string): Promise<(KeyOwner & { handle: string }) | undefined>;
    environments: Pick<PublishingEnvironments, 'registerWithToken'>;
    /** CLI がその鍵の秘密鍵を持っていることの証明 */
    verifyProof(request: { id: string; publicKey: string }, signature: string): Promise<boolean>;
    accountOf(handle: string): string;
    secrets: { random(bytes: number): string; userCode(): string; apiToken(): string };
    hash(value: string): string;
    now(): Date;
}

type Refusal<S extends number> = { ok: false; status: S; error: string };

export function createCliAuth(deps: CliAuthDeps) {
    return {
        /** 要求を作る。ループバックなら redirectUri + codeChallenge、デバイス認可ならどちらも無し。 */
        async createRequest(
            input: CliAuthRequestInput,
        ): Promise<
            | Refusal<400>
            | { ok: true; requestId: string; deviceCode: string | null; userCode: string | null; expiresAt: Date }
        > {
            const flow = requestFlowOf(input);
            if (typeof flow === 'object') return { ok: false, status: 400, error: flow.error };
            const requestId = deps.secrets.random(16);
            const deviceCode = flow === 'device' ? deps.secrets.random(32) : null;
            const userCode = flow === 'device' ? deps.secrets.userCode() : null;
            const expiresAt = new Date(deps.now().getTime() + CLI_AUTH_REQUEST_TTL_MS);
            await deps.requests.create({
                id: requestId,
                kind: input.kind,
                name: input.name,
                publicKey: input.publicKey,
                redirectUri: input.redirectUri ?? null,
                codeChallenge: input.codeChallenge ?? null,
                userCode,
                deviceCodeHash: deviceCode ? deps.hash(deviceCode) : null,
                expiresAt,
            });
            return { ok: true, requestId, deviceCode, userCode, expiresAt };
        },

        async findRequest(id: string): Promise<CliAuthRequestView | undefined> {
            const request = await deps.requests.findActive(id);
            return request && cliAuthRequestView(request);
        },

        /** デバイス認可は画面で入力された user code（正規化したもの）で引く。 */
        async findRequestByUserCode(userCode: string): Promise<CliAuthRequestView | undefined> {
            const request = await deps.requests.findActiveByUserCode(userCode);
            return request && cliAuthRequestView(request);
        },

        /** 承認する。ループバックならリダイレクト先（認可コードと CLI が付けた state 付き）を返す。 */
        async approve(
            userId: string,
            requestId: string,
            state: string | undefined,
        ): Promise<Refusal<404 | 409> | { ok: true; redirect: string | null }> {
            const user = await deps.findUser(userId);
            if (!user) return { ok: false, status: 404, error: 'User not found' };
            const request = await deps.requests.findActive(requestId);
            if (request?.status !== 'pending') {
                return {
                    ok: false,
                    status: 404,
                    error: '承認できる要求が見つかりません（期限切れか、処理済みです）',
                };
            }
            const code = request.redirectUri ? deps.secrets.random(32) : null;
            if (!(await deps.requests.approve(request.id, user.id, code ? deps.hash(code) : null))) {
                return { ok: false, status: 409, error: 'この要求はすでに処理されています' };
            }
            return {
                ok: true,
                redirect: request.redirectUri && code ? loopbackRedirect(request.redirectUri, code, state) : null,
            };
        },

        /**
         * 引き換える（鍵の所有の証明）。ここで公開環境と API トークンを作る。
         * 引き換え済みにしてから作るので、同時に送られても 1 つしか通らない。作れなかった要求は使い切りになる
         * （同じ鍵では作れないので、CLI は鍵から作り直す）。
         */
        async exchange(
            requestId: string,
            signature: string,
            input: ExchangeInput,
        ): Promise<
            | Extract<ExchangeOutcome, { ok: false }>
            | { ok: true; token: string; account: string; environment: PublishingEnvironmentView }
        > {
            const request = await deps.requests.findActive(requestId);
            const outcome = exchangeOutcome(request, input, deps.now(), deps.hash);
            if (!outcome.ok) return outcome;
            if (!request?.userId) {
                return { ok: false, status: 400, code: 'invalid-grant', error: '認可コードが一致しません' };
            }
            if (!(await deps.verifyProof(request, signature))) {
                return { ok: false, status: 400, code: 'invalid-proof', error: '鍵の所有を確認できません' };
            }
            if (!(await deps.requests.consume(request.id))) {
                return { ok: false, status: 409, code: 'consumed', error: 'この認可の要求は引き換え済みです' };
            }
            const user = await deps.findUser(request.userId);
            if (!user) {
                return { ok: false, status: 409, code: 'author-not-found', error: '作者アカウントが見つかりません' };
            }
            const token = deps.secrets.apiToken();
            const environment = await deps.environments.registerWithToken(user, {
                kind: request.kind,
                name: request.name,
                publicKey: request.publicKey,
                apiTokenHash: deps.hash(token),
            });
            if (!environment) {
                return { ok: false, status: 409, code: 'taken', error: 'この鍵は登録できません（作り直してください）' };
            }
            return { ok: true, token, account: deps.accountOf(user.handle), environment };
        },
    };
}

export type CliAuth = ReturnType<typeof createCliAuth>;
