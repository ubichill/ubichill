// インスタンスサーバーの WebSocket と backend の API の、読み書きと判断。k6 のモジュールに依存しない（vitest で確かめる）。

export interface Frame {
    readonly event?: string;
    readonly data?: unknown;
    readonly id?: string;
    readonly replyTo?: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const encodeFrame = (event: string, data: unknown, id?: string): string =>
    JSON.stringify(id === undefined ? { event, data } : { event, id, data });

export function parseFrame(raw: unknown): Frame | null {
    if (typeof raw !== 'string') return null;
    try {
        const value: unknown = JSON.parse(raw);
        if (!isRecord(value)) return null;
        return {
            event: typeof value.event === 'string' ? value.event : undefined,
            data: value.data,
            id: typeof value.id === 'string' ? value.id : undefined,
            replyTo: typeof value.replyTo === 'string' ? value.replyTo : undefined,
        };
    } catch {
        return null;
    }
}

// ---- 応答の分類と再試行 ----

export type RequestResult = 'ok' | 'migrating' | 'conflict' | 'error' | 'timeout';

/** 応答の無いまま期限が来たら undefined を渡す。 */
export function requestResult(reply: unknown): RequestResult {
    if (reply === undefined) return 'timeout';
    if (!isRecord(reply)) return 'error';
    if (reply.success === true) return 'ok';
    return reply.code === 'migrating' || reply.code === 'conflict' ? reply.code : 'error';
}

export type JoinFailure = 'ticket_invalid' | 'instance_unavailable' | 'rejected' | 'timeout';

export function joinFailure(reply: unknown): JoinFailure {
    if (reply === undefined) return 'timeout';
    const code = isRecord(reply) ? reply.code : undefined;
    return code === 'ticket_invalid' || code === 'instance_unavailable' ? code : 'rejected';
}

export const MIGRATING_RETRY_MS = 500;
export const MAX_MIGRATING_RETRIES = 3;
export const MAX_JOIN_RETRIES = 2;

/** 引っ越し中（migrating）の要求は、Host と同じく少し待って同じ操作を送り直す。待つ ms か、諦めるなら null。 */
export const migratingRetryDelay = (result: RequestResult, attempt: number): number | null =>
    result === 'migrating' && attempt < MAX_MIGRATING_RETRIES ? MIGRATING_RETRY_MS : null;

/** 入室の失敗のうち、チケットを取り直せば入れるもの（Host の再接続と同じ）。待つ ms か、諦めるなら null。 */
export const joinRetryDelay = (failure: JoinFailure, attempt: number): number | null =>
    (failure === 'ticket_invalid' || failure === 'instance_unavailable') && attempt < MAX_JOIN_RETRIES
        ? 500 * (attempt + 1)
        : null;

// ---- カーソルの遅延 ----

// Go は |x|, |y| <= 1e7 しか受けないので、時刻はこの法で入れる（約 2.7 時間で一周）
export const STAMP_MODULO = 1e7;
/** 1 人目のカーソルの y。2 人目はこれで 1 人目のカーソルを見分ける（ほかの人は 0 以上） */
export const LATENCY_MARK_Y = -1;

export const stampOf = (nowMs: number): number => Math.floor(nowMs) % STAMP_MODULO;

export function latencyMs(stamp: number, nowMs: number): number {
    const diff = stampOf(nowMs) - stamp;
    return diff < 0 ? diff + STAMP_MODULO : diff;
}

/** 送るカーソルの位置。1 人目は x に時刻、y に印を入れる。ほかの人は 0〜1000 の乱数。 */
export const cursorPosition = (marked: boolean, nowMs: number, random: () => number): { x: number; y: number } =>
    marked
        ? { x: stampOf(nowMs), y: LATENCY_MARK_Y }
        : { x: Math.floor(random() * 1000), y: Math.floor(random() * 1000) };

const markedStamp = (entry: unknown): number[] => {
    if (!isRecord(entry) || !isRecord(entry.position)) return [];
    const { x, y } = entry.position;
    return typeof x === 'number' && y === LATENCY_MARK_Y ? [x] : [];
};

/** cursor:moved（1 件）と cursors:moved（まとめ送り: [{userId, position, heldEntityId?}]）から、1 人目の時刻を取り出す。 */
export function cursorStamps(event: string, data: unknown): number[] {
    if (event === 'cursor:moved') return markedStamp(data);
    if (event === 'cursors:moved' && Array.isArray(data)) return data.flatMap(markedStamp);
    return [];
}

// ---- 知らせ・切断 ----

/** 数える知らせの種類。数えないイベントは null。 */
export function noticeKind(event: string, data: unknown): string | null {
    if (event === 'server:notice') return isRecord(data) && typeof data.kind === 'string' ? data.kind : 'unknown';
    if (event === 'session:replaced') return 'session_replaced';
    if (event === 'instance:closing') return 'instance_closing';
    return null;
}

/** 切断を自分で始めたか（退室・入室の失敗）。server の切断は、利用者から見れば落ちたのと同じ。 */
export const closedBy = (initiatedByClient: boolean): 'client' | 'server' => (initiatedByClient ? 'client' : 'server');

// ---- エンティティ・共有状態 ----

/** entity:create の応答から作られたエンティティの ID を取り出す。 */
export const createdEntityId = (reply: unknown): string | null =>
    isRecord(reply) && reply.success === true && isRecord(reply.entity) && typeof reply.entity.id === 'string'
        ? reply.entity.id
        : null;

/** state:update の応答・state:changed から、次に送る expectedRevision を決める。競合の応答も今の entry を返す。 */
export function nextRevision(current: number, payload: unknown): number {
    const entry = isRecord(payload) && 'entry' in payload ? payload.entry : payload;
    if (entry === null && isRecord(payload) && payload.code === 'conflict') return 0;
    return isRecord(entry) && typeof entry.revision === 'number' ? Math.max(current, entry.revision) : current;
}

// ---- URL・Cookie・API の応答 ----

export interface UrlParts {
    readonly scheme: string;
    /** ホスト名とポート（userinfo は除く） */
    readonly host: string;
    readonly hostname: string;
    /** パス・クエリ・フラグメント（無ければ空） */
    readonly rest: string;
}

/** 絶対 URL を分ける。k6 には WHATWG の URL が無いので自分で読む。読めなければ null。 */
export function splitUrl(url: string): UrlParts | null {
    const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(url.trim());
    if (!match) return null;
    const authority = (match[2] ?? '').replace(/^.*@/, '');
    const hostname = authority.startsWith('[')
        ? authority.slice(0, authority.indexOf(']') + 1)
        : authority.split(':')[0];
    if (!hostname) return null;
    return {
        scheme: (match[1] ?? '').toLowerCase(),
        host: authority.toLowerCase(),
        hostname: hostname.toLowerCase(),
        rest: match[3] ?? '',
    };
}

const SOCKET_SCHEMES: Readonly<Record<string, string>> = { http: 'ws', https: 'wss', ws: 'ws', wss: 'wss' };

/**
 * 参加情報の url（相対・絶対・http(s)/ws(s)）を WebSocket の URL にする。相対なら画面のオリジンが基準（ブラウザと同じ）。
 * wsBase を渡すと、スキームとホストをそれに置き換える（クラスタの中から Go の Service へ直接繋ぐ）。
 */
export function resolveSocketUrl(joinUrl: string, origin: string, wsBase: string | null): string {
    const absolute = splitUrl(joinUrl);
    const page = splitUrl(origin);
    if (absolute === null && page === null) throw new Error(`画面のオリジンが URL ではありません: ${origin}`);
    const rest = absolute?.rest ?? (joinUrl.startsWith('/') ? joinUrl : `/${joinUrl}`);
    const base = wsBase === null ? (absolute ?? page) : splitUrl(wsBase);
    const scheme = base === null ? undefined : SOCKET_SCHEMES[base.scheme];
    if (base === null || scheme === undefined) throw new Error(`WebSocket にできない URL です: ${wsBase ?? joinUrl}`);
    return `${scheme}://${base.host}${rest === '' ? '/' : rest}`;
}

export interface ResponseCookie {
    readonly value: string;
}

/**
 * ログインの応答の Cookie を、次の要求の Cookie ヘッダーにする。
 * k6 の cookie jar は Secure の Cookie（better-auth の __Secure-*）を http:// のクラスタ内の backend へ送らないので自分で持つ。
 */
export function cookieHeader(cookies: Readonly<Record<string, readonly ResponseCookie[]>>): string {
    return Object.entries(cookies)
        .flatMap(([name, values]) => {
            const last = values[values.length - 1];
            return last === undefined || last.value === '' ? [] : [`${name}=${last.value}`];
        })
        .join('; ');
}

export type AccountStep = 'signed_in' | 'register' | 'rate_limited' | 'failed';

/** ログインの応答の状態から次の手を決める。アカウントが無い（認証の失敗）なら登録してからログインし直す。 */
export function accountStep(signInStatus: number): AccountStep {
    if (signInStatus >= 200 && signInStatus < 300) return 'signed_in';
    if (signInStatus === 401 || signInStatus === 403) return 'register';
    if (signInStatus === 429) return 'rate_limited';
    return 'failed';
}

/** GET /api/v1/instances?worldId= の応答から、部屋の印（access.tags）の付いたインスタンスの ID を探す。 */
export function findTaggedInstance(body: unknown, tag: string): string | null {
    const list = isRecord(body) && Array.isArray(body.instances) ? body.instances : [];
    const found = list.find(
        (instance) =>
            isRecord(instance) &&
            typeof instance.id === 'string' &&
            isRecord(instance.access) &&
            Array.isArray(instance.access.tags) &&
            instance.access.tags.includes(tag),
    );
    return isRecord(found) && typeof found.id === 'string' ? found.id : null;
}

export interface JoinGrant {
    readonly token: string;
    readonly url: string;
}

export const joinGrant = (body: unknown): JoinGrant | null =>
    isRecord(body) && typeof body.token === 'string' && typeof body.url === 'string'
        ? { token: body.token, url: body.url }
        : null;

export interface WorldSummary {
    readonly id: string;
    readonly displayName: string;
    readonly capacityMax: number;
}

/** GET /api/v1/worlds の応答からワールドを探す（id か url で）。 */
export function findWorld(body: unknown, worldId: string): WorldSummary | null {
    const list = isRecord(body) && Array.isArray(body.worlds) ? body.worlds : [];
    const found = list.find((w) => isRecord(w) && (w.id === worldId || w.url === worldId));
    if (!isRecord(found) || typeof found.id !== 'string' || typeof found.displayName !== 'string') return null;
    const capacity = isRecord(found.capacity) && typeof found.capacity.max === 'number' ? found.capacity.max : 0;
    return { id: found.id, displayName: found.displayName, capacityMax: capacity };
}

/** 部屋の人数がワールドの定員を超えると、backend が maxUsers を capacity.max に丸め、溢れた人は入れない。 */
export const capacityProblem = (world: WorldSummary, usersPerRoom: number): string | null =>
    usersPerRoom > world.capacityMax
        ? `ワールド ${world.id} の定員（capacity.max）は ${world.capacityMax} 人で、1 部屋 ${usersPerRoom} 人は入れません。capacity.max の大きいワールドを LT_WORLD に指定してください`
        : null;

/** インスタンスの URL（/instance/<id>）から ID を取り出す。 */
export function instanceIdFromUrl(url: string): string | null {
    const match = /\/instance\/([^/?#]+)/.exec(url);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
}
