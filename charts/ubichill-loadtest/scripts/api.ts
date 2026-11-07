// backend の API（利用者がブラウザから呼ぶのと同じ口）。管理 API・管理トークンは使わない。

import { sleep } from 'k6';
import { expectedStatuses, request } from 'k6/http';
import type { LoadTestAccount } from './plan.ts';
import { accountStep, cookieHeader, findTaggedInstance, isRecord, type JoinGrant, joinGrant } from './protocol.ts';

export interface ApiTarget {
    /** better-auth は Origin ヘッダーで CSRF を確かめる。ブラウザと同じ画面のオリジンを付ける */
    readonly origin: string;
    readonly apiBase: string;
}

interface Call {
    readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    readonly path: string;
    /** 指標の name タグ（インスタンス ID を含めない） */
    readonly name: string;
    readonly body?: unknown;
    readonly cookie?: string;
    /** http_req_failed に数えない 4xx（アカウントが無いときのログインの 401 など） */
    readonly expected?: readonly number[];
}

function call(target: ApiTarget, { method, path, name, body, cookie, expected = [] }: Call) {
    const headers: Record<string, string> = { origin: target.origin, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    return request(method, `${target.apiBase}${path}`, body === undefined ? null : JSON.stringify(body), {
        headers,
        tags: { name },
        redirects: 0,
        timeout: '15s',
        responseCallback: expectedStatuses({ min: 200, max: 399 }, ...expected),
    });
}

const json = (body: unknown): unknown => {
    if (typeof body !== 'string' || body === '') return null;
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
};

export type SessionResult =
    | { readonly ok: true; readonly cookie: string }
    | { readonly ok: false; readonly reason: string };

function signIn(target: ApiTarget, account: LoadTestAccount) {
    return call(target, {
        method: 'POST',
        path: '/api/auth/sign-in/email',
        name: 'POST /api/auth/sign-in/email',
        body: { email: account.email, password: account.password },
        expected: [401],
    });
}

/** ログインする。アカウントが無ければ登録してからログインし直す（dev は SKIP_EMAIL_VERIFICATION で登録が即時）。 */
export function ensureSession(target: ApiTarget, account: LoadTestAccount): SessionResult {
    const first = signIn(target, account);
    const step = accountStep(first.status);
    if (step === 'signed_in') return sessionFrom(first.cookies);
    if (step !== 'register')
        return { ok: false, reason: step === 'rate_limited' ? 'rate_limited' : `signin_${first.status}` };
    const registered = call(target, {
        method: 'POST',
        path: '/api/v1/users/register',
        name: 'POST /api/v1/users/register',
        body: {
            email: account.email,
            password: account.password,
            displayName: account.displayName,
            handle: account.handle,
        },
    });
    const body = json(registered.body);
    if (registered.status !== 200 || !isRecord(body) || body.skipVerification !== true) {
        return { ok: false, reason: registered.status === 429 ? 'rate_limited' : `register_${registered.status}` };
    }
    const second = signIn(target, account);
    return accountStep(second.status) === 'signed_in'
        ? sessionFrom(second.cookies)
        : { ok: false, reason: `signin_${second.status}` };
}

function sessionFrom(cookies: Parameters<typeof cookieHeader>[0]): SessionResult {
    const cookie = cookieHeader(cookies);
    return cookie === '' ? { ok: false, reason: 'no_cookie' } : { ok: true, cookie };
}

export type CreateResult =
    | { readonly id: string }
    | { readonly error: 'rate_limited' | 'error'; readonly status: number };

export function createInstance(
    target: ApiTarget,
    cookie: string,
    input: { readonly worldId: string; readonly tag: string; readonly maxUsers: number },
): CreateResult {
    const response = call(target, {
        method: 'POST',
        path: '/api/v1/instances',
        name: 'POST /api/v1/instances',
        cookie,
        body: {
            worldId: input.worldId,
            access: { type: 'public', tags: [input.tag] },
            settings: { maxUsers: input.maxUsers },
        },
    });
    const body = json(response.body);
    if (response.status === 201 && isRecord(body) && typeof body.id === 'string') return { id: body.id };
    return { error: response.status === 429 ? 'rate_limited' : 'error', status: response.status };
}

/**
 * ワールドの詳細を開いたときと同じ一覧（GET /api/v1/instances?worldId=）から、部屋の印の付いたインスタンスを探す。
 * 1 人目が作るまで、期限まで待ちながら探し直す。
 */
export function discoverInstance(
    target: ApiTarget,
    cookie: string,
    input: {
        readonly worldId: string;
        readonly tag: string;
        readonly deadlineMs: number;
        readonly intervalSeconds: number;
    },
): string | null {
    const response = call(target, {
        method: 'GET',
        path: `/api/v1/instances?worldId=${encodeURIComponent(input.worldId)}`,
        name: 'GET /api/v1/instances?worldId',
        cookie,
    });
    const found = response.status === 200 ? findTaggedInstance(json(response.body), input.tag) : null;
    if (found !== null || Date.now() + input.intervalSeconds * 1000 > input.deadlineMs) return found;
    sleep(input.intervalSeconds);
    return discoverInstance(target, cookie, input);
}

export type TicketResult = JoinGrant | { readonly error: string };

/** 参加情報（Go 用の短期チケットと WebSocket の URL）。 */
export function joinTicket(target: ApiTarget, cookie: string, instanceId: string): TicketResult {
    const response = call(target, {
        method: 'POST',
        path: `/api/v1/instances/${encodeURIComponent(instanceId)}/join`,
        name: 'POST /api/v1/instances/:id/join',
        cookie,
        body: {},
    });
    const grant = response.status === 200 ? joinGrant(json(response.body)) : null;
    return grant ?? { error: `status_${response.status}` };
}

/** インスタンスを終える（作った人だけ）。空になれば backend の掃除でも消えるので、無ければ not_found。 */
export function deleteInstance(target: ApiTarget, cookie: string, instanceId: string): 'ok' | 'not_found' | 'error' {
    const response = call(target, {
        method: 'DELETE',
        path: `/api/v1/instances/${encodeURIComponent(instanceId)}`,
        name: 'DELETE /api/v1/instances/:id',
        cookie,
        expected: [404],
    });
    if (response.status === 204) return 'ok';
    return response.status === 404 ? 'not_found' : 'error';
}

/** ログインしたら入るホームのワールドを決める（画面の確認で、試験のワールドに入るため）。 */
export function setHomeWorld(target: ApiTarget, cookie: string, worldId: string): boolean {
    const response = call(target, {
        method: 'PUT',
        path: '/api/v1/users/me/home',
        name: 'PUT /api/v1/users/me/home',
        cookie,
        body: { worldRef: worldId, accessType: 'invite_only' },
    });
    return response.status === 200;
}

export function getJson(target: ApiTarget, path: string): { readonly status: number; readonly body: unknown } {
    const response = call(target, { method: 'GET', path, name: `GET ${path}` });
    return { status: response.status, body: json(response.body) };
}
