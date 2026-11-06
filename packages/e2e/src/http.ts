import type { SmokeAccount } from './account.ts';
import type { SmokeTarget } from './target.ts';

export type Fetch = typeof fetch;

export interface Session {
    readonly account: SmokeAccount;
    /** Cookie ヘッダーにそのまま載せる値 */
    readonly cookie: string;
}

interface RequestOptions {
    readonly method?: string;
    readonly body?: unknown;
    readonly cookie?: string;
}

/** JSON の API を呼ぶ。2xx 以外は、メソッド・パス・状態・本文の頭を含めて投げる（どこで落ちたか分かるように）。 */
export async function requestJson(fetchFn: Fetch, target: SmokeTarget, path: string, options: RequestOptions = {}) {
    const response = await sendRequest(fetchFn, target, path, options);
    return readJson(response, options.method ?? 'GET', path);
}

export async function register(fetchFn: Fetch, target: SmokeTarget, account: SmokeAccount): Promise<void> {
    const body = await requestJson(fetchFn, target, '/api/v1/users/register', {
        method: 'POST',
        body: {
            email: account.email,
            password: account.password,
            displayName: account.displayName,
            handle: account.handle,
        },
    });
    if (!isRecord(body) || body.skipVerification !== true) {
        throw new Error(
            `登録が即時に終わりませんでした（SKIP_EMAIL_VERIFICATION が効いていない環境です）: ${preview(body)}`,
        );
    }
}

export async function signIn(fetchFn: Fetch, target: SmokeTarget, account: SmokeAccount): Promise<Session> {
    const response = await sendRequest(fetchFn, target, '/api/auth/sign-in/email', {
        method: 'POST',
        body: { email: account.email, password: account.password },
    });
    await readJson(response, 'POST', '/api/auth/sign-in/email');
    const cookie = cookieHeader(response.headers.getSetCookie());
    if (!cookie) throw new Error('ログインの応答に Set-Cookie がありません');
    return { account, cookie };
}

/** Set-Cookie の並びを Cookie ヘッダーの値にする（属性は捨てる）。 */
export function cookieHeader(setCookies: readonly string[]): string {
    return setCookies
        .map((line) => line.split(';')[0]?.trim() ?? '')
        .filter((pair) => pair.includes('='))
        .join('; ');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function preview(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function sendRequest(
    fetchFn: Fetch,
    { origin, apiOrigin }: SmokeTarget,
    path: string,
    { method = 'GET', body, cookie }: RequestOptions,
) {
    // better-auth は origin ヘッダーで CSRF を確かめる。ブラウザ以外から呼ぶので自分で付ける
    const headers: Record<string, string> = { origin, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    return fetchFn(new URL(path, apiOrigin), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
    });
}

async function readJson(response: Response, method: string, path: string): Promise<unknown> {
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} が ${response.status} を返しました: ${preview(text)}`);
    if (text === '') return null;
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${method} ${path} の応答が JSON ではありません: ${preview(text)}`);
    }
}
