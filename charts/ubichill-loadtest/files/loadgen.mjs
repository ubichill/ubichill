// Go インスタンス（WebSocket）の負荷生成器。Node 22+ の組み込み WebSocket と fetch だけで動く（依存なし）。
// 純粋な計算（設定・部屋 ID・ランプ・指標・ヒストグラム・遅延）は export して loadgen.test.mjs で確かめる。
// 指標の名前とラベルは Grafana のダッシュボード（Ubichill / Load test）が参照するので変えない。
import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
export const JOIN_FAILURE_REASONS = ['timeout', 'ticket_invalid', 'instance_unavailable', 'other'];
export const REQUEST_EVENTS = ['entity:create', 'entity:patch', 'state:update'];
export const REQUEST_RESULTS = ['ok', 'migrating', 'conflict', 'error', 'timeout'];
export const CLIENT_STATES = ['connecting', 'joined', 'closed'];
export const SENT_EVENTS = ['world:join', 'cursor:move', ...REQUEST_EVENTS];
export const RECEIVED_EVENTS = [
    'reply',
    'world:snapshot',
    'users:update',
    'user:joined',
    'user:left',
    'cursor:moved',
    'entity:created',
    'entity:patched',
    'state:changed',
    'server:notice',
    'session:replaced',
    'error',
];

// カーソルの x に入れる時刻の法。Go は |x| <= 1e7 しか受けない
const STAMP_MODULO = 1e7;
const REQUEST_TIMEOUT_MS = 5_000;
const JOIN_TIMEOUT_MS = 10_000;
const SUMMARY_INTERVAL_MS = 10_000;
const MIGRATING_RETRY_MS = 500;
const ADMIN_RETRIES = 3;

// ---- 設定 ----

const numberOr = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isNaN(n) ? fallback : n;
};

export function parseConfig(env) {
    const usersPerRoom = numberOr(env.LOADTEST_USERS_PER_ROOM, 10);
    return {
        instanceUrl: (env.LOADTEST_INSTANCE_URL ?? '').replace(/\/+$/, ''),
        adminToken: env.LOADTEST_ADMIN_TOKEN ?? '',
        scenario: env.LOADTEST_SCENARIO || 'default',
        roomsPerWorker: numberOr(env.LOADTEST_ROOMS_PER_WORKER, 1),
        usersPerRoom,
        cursorHz: numberOr(env.LOADTEST_CURSOR_HZ, 20),
        activeRatio: numberOr(env.LOADTEST_ACTIVE_RATIO, 0.3),
        durationSeconds: numberOr(env.LOADTEST_DURATION_SECONDS, 60),
        rampSeconds: numberOr(env.LOADTEST_RAMP_SECONDS, 30),
        patchIntervalSeconds: numberOr(env.LOADTEST_PATCH_INTERVAL_SECONDS, 5),
        maxUsersPerRoom: numberOr(env.LOADTEST_MAX_USERS_PER_ROOM, usersPerRoom + 5),
        holdSeconds: numberOr(env.LOADTEST_HOLD_SECONDS, 30),
        roomPrefix: env.LOADTEST_ROOM_PREFIX || 'loadtest',
        metricsPort: numberOr(env.LOADTEST_METRICS_PORT, 9400),
        // 閉じた部屋の ID は 2 分間作り直せない（Go の retiredFor）。Pod の外では乱数で避ける
        podName: env.POD_NAME || `local-${Math.random().toString(36).slice(2, 7)}`,
    };
}

/** 本番の Go の Service 名（ubichill-instance）そのものを向いた URL か。chart の fail と二重に守る。 */
export function isProductionTarget(instanceUrl) {
    try {
        const host = new URL(instanceUrl).hostname;
        return host === 'ubichill-instance' || host.startsWith('ubichill-instance.');
    } catch {
        return false;
    }
}

const isInteger = (n, min, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(n) && n >= min && n <= max;

export function validateConfig(config) {
    const checks = [
        [/^https?:\/\//.test(config.instanceUrl), 'LOADTEST_INSTANCE_URL は http(s) の URL'],
        [
            !isProductionTarget(config.instanceUrl),
            'LOADTEST_INSTANCE_URL が本番の Service（ubichill-instance）を向いている',
        ],
        [config.adminToken !== '', 'LOADTEST_ADMIN_TOKEN が空'],
        [/^[A-Za-z0-9_.-]+$/.test(config.scenario), 'LOADTEST_SCENARIO は英数字・-_. のみ'],
        [isInteger(config.roomsPerWorker, 1), 'LOADTEST_ROOMS_PER_WORKER は 1 以上の整数'],
        [isInteger(config.usersPerRoom, 1, 1000), 'LOADTEST_USERS_PER_ROOM は 1〜1000 の整数'],
        [
            isInteger(config.maxUsersPerRoom, config.usersPerRoom, 1000),
            'LOADTEST_MAX_USERS_PER_ROOM は usersPerRoom 以上 1000 以下の整数',
        ],
        [config.cursorHz >= 0 && config.cursorHz <= 240, 'LOADTEST_CURSOR_HZ は 0〜240'],
        [config.activeRatio >= 0 && config.activeRatio <= 1, 'LOADTEST_ACTIVE_RATIO は 0〜1'],
        [config.durationSeconds > 0, 'LOADTEST_DURATION_SECONDS は正の数'],
        [config.rampSeconds >= 0, 'LOADTEST_RAMP_SECONDS は 0 以上'],
        [config.patchIntervalSeconds >= 0, 'LOADTEST_PATCH_INTERVAL_SECONDS は 0 以上'],
        [config.holdSeconds >= 0, 'LOADTEST_HOLD_SECONDS は 0 以上'],
        [/^[a-z0-9-]+$/.test(config.roomPrefix), 'LOADTEST_ROOM_PREFIX は小文字英数字と -'],
        [isInteger(config.metricsPort, 1, 65535), 'LOADTEST_METRICS_PORT は 1〜65535'],
    ];
    return checks.filter(([ok]) => !ok).map(([, message]) => message);
}

// ---- 部屋と利用者の計画 ----

/** Pod 名の末尾（Job が付ける乱数）。worker ごとに部屋 ID が重ならないようにする。 */
export const workerSuffix = (podName) => podName.slice(podName.lastIndexOf('-') + 1) || podName;

export const roomIds = (prefix, suffix, count) =>
    Array.from({ length: count }, (_, i) => `${prefix}-${suffix}-${i + 1}`);

/** 部屋の中でカーソルを送る人数。1 人目（遅延の送り手）は ratio > 0 なら必ず含める。 */
export const activeClientCount = (usersPerRoom, activeRatio) =>
    activeRatio <= 0 ? 0 : Math.min(usersPerRoom, Math.max(1, Math.round(usersPerRoom * activeRatio)));

/** 接続の開始時刻（ms、0 始まり）。total 本を rampMs の間に均等に始める。 */
export const rampSchedule = (total, rampMs) =>
    Array.from({ length: total }, (_, i) => Math.floor((i * rampMs) / Math.max(total, 1)));

export function planClients(config, rooms) {
    const active = activeClientCount(config.usersPerRoom, config.activeRatio);
    return rooms.flatMap((roomId, roomIndex) =>
        Array.from({ length: config.usersPerRoom }, (_, index) => ({
            roomId,
            index,
            userId: `${roomId}-u${index + 1}`,
            senderId: `${roomId}-u1`,
            name: `lt ${roomIndex + 1}-${index + 1}`,
            active: index < active,
            // 1 人目が時刻入りのカーソルを送り、2 人目が受けて遅延を測る。同じプロセスの時計なので差を取れる
            role: index === 0 ? 'sender' : index === 1 ? 'receiver' : 'member',
        })),
    );
}

// ---- 遅延 ----

export const stampOf = (nowMs) => nowMs % STAMP_MODULO;

export const latencySecondsFromStamp = (stamp, nowMs) => {
    const diff = stampOf(nowMs) - stamp;
    return (diff < 0 ? diff + STAMP_MODULO : diff) / 1000;
};

// ---- ヒストグラム（不変。observe は新しい値を返す） ----

export const createHistogram = (buckets = LATENCY_BUCKETS) => ({
    buckets,
    counts: buckets.map(() => 0),
    sum: 0,
    count: 0,
});

export const observeHistogram = (histogram, value) => ({
    ...histogram,
    counts: histogram.counts.map((c, i) => (value <= histogram.buckets[i] ? c + 1 : c)),
    sum: histogram.sum + value,
    count: histogram.count + 1,
});

/** Prometheus の histogram_quantile と同じ線形補間。最後の bucket を超える分はその上限を返す。 */
export function histogramQuantile(histogram, q) {
    if (histogram.count === 0) return null;
    const rank = q * histogram.count;
    const found = histogram.counts.reduce(
        (acc, c, i) => (acc.index >= 0 ? acc : c >= rank ? { index: i, below: acc.below } : { index: -1, below: c }),
        { index: -1, below: 0 },
    );
    if (found.index < 0) return histogram.buckets[histogram.buckets.length - 1];
    const lower = found.index === 0 ? 0 : histogram.buckets[found.index - 1];
    const upper = histogram.buckets[found.index];
    const width = histogram.counts[found.index] - found.below;
    return width === 0 ? upper : lower + ((upper - lower) * (rank - found.below)) / width;
}

// ---- 指標の描画（Prometheus text 形式 0.0.4） ----

const escapeLabel = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export const renderLabels = (labels) => {
    const entries = Object.entries(labels);
    return entries.length === 0 ? '' : `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;
};

const formatNumber = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12))));

// counts は observeHistogram が累積で持つ（le 以下の件数）ので、そのまま _bucket に出す
const renderHistogramSeries = (name, labels, h) => {
    const bucketLines = h.buckets.map((le, i) => `${name}_bucket${renderLabels({ ...labels, le })} ${h.counts[i]}`);
    return [
        ...bucketLines,
        `${name}_bucket${renderLabels({ ...labels, le: '+Inf' })} ${h.count}`,
        `${name}_sum${renderLabels(labels)} ${formatNumber(h.sum)}`,
        `${name}_count${renderLabels(labels)} ${h.count}`,
    ];
};

export function renderMetrics(families) {
    return families
        .map((family) => {
            const header = [`# HELP ${family.name} ${family.help}`, `# TYPE ${family.name} ${family.type}`];
            const lines = family.series.flatMap((s) =>
                family.type === 'histogram'
                    ? renderHistogramSeries(family.name, s.labels, s.histogram)
                    : [`${family.name}${renderLabels(s.labels)} ${formatNumber(s.value)}`],
            );
            return [...header, ...lines].join('\n');
        })
        .join('\n')
        .concat('\n');
}

// ---- レジストリ（mutable な Map をここだけに閉じ込める） ----

const seriesKey = (labels) => JSON.stringify(Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1)));

export function createRegistry(scenario) {
    const families = new Map();

    const define = (name, type, help) => {
        families.set(name, { name, type, help, series: new Map() });
    };
    const family = (name) => {
        const found = families.get(name);
        if (!found) throw new Error(`未定義の指標: ${name}`);
        return found;
    };
    const series = (name, labels, initial) => {
        const f = family(name);
        const full = { scenario, ...labels };
        const key = seriesKey(full);
        const existing = f.series.get(key);
        if (existing) return existing;
        const created = { labels: full, ...initial() };
        f.series.set(key, created);
        return created;
    };

    const prefix = 'ubichill_loadtest_';
    define(`${prefix}info`, 'gauge', 'Scenario parameters of this load test worker.');
    define(`${prefix}clients`, 'gauge', 'Simulated clients by state.');
    define(`${prefix}rooms`, 'gauge', 'Rooms this worker created.');
    define(`${prefix}join_failures_total`, 'counter', 'world:join attempts that did not reach world:snapshot.');
    define(`${prefix}frames_sent_total`, 'counter', 'WebSocket frames sent, by event.');
    define(`${prefix}frames_received_total`, 'counter', 'WebSocket frames received, by event (replies as "reply").');
    define(
        `${prefix}cursor_latency_seconds`,
        'histogram',
        'cursor:move to cursor:moved latency measured between two clients of the same room.',
    );
    define(`${prefix}join_seconds`, 'histogram', 'Time from opening the WebSocket until world:snapshot.');
    define(`${prefix}requests_total`, 'counter', 'Requests with a reply, by event and result.');
    define(`${prefix}disconnects_total`, 'counter', 'WebSocket closes, by close code.');
    define(`${prefix}notices_total`, 'counter', 'server:notice frames received, by kind.');

    const counter = (name, labels) => series(name, labels, () => ({ value: 0 }));
    const gauge = counter;
    const histogram = (name, labels) => series(name, labels, () => ({ histogram: createHistogram() }));

    const api = {
        inc: (name, labels = {}, delta = 1) => {
            counter(`${prefix}${name}`, labels).value += delta;
        },
        set: (name, labels, value) => {
            gauge(`${prefix}${name}`, labels).value = value;
        },
        observe: (name, labels, value) => {
            const s = histogram(`${prefix}${name}`, labels);
            s.histogram = observeHistogram(s.histogram, value);
        },
        snapshot: () =>
            [...families.values()].map((f) => ({
                name: f.name,
                type: f.type,
                help: f.help,
                series: [...f.series.values()].map((s) => ({ ...s })),
            })),
        render: () => renderMetrics(api.snapshot()),
    };

    // 0 の系列を先に出しておく（rate() は系列が無いと何も描けない）
    for (const state of CLIENT_STATES) api.set('clients', { state }, 0);
    api.set('rooms', {}, 0);
    for (const reason of JOIN_FAILURE_REASONS) api.inc('join_failures_total', { reason }, 0);
    for (const event of SENT_EVENTS) api.inc('frames_sent_total', { event }, 0);
    for (const event of RECEIVED_EVENTS) api.inc('frames_received_total', { event }, 0);
    for (const event of REQUEST_EVENTS) {
        for (const result of REQUEST_RESULTS) api.inc('requests_total', { event, result }, 0);
    }
    histogram(`${prefix}cursor_latency_seconds`, {});
    histogram(`${prefix}join_seconds`, {});
    return api;
}

// ---- 応答の分類 ----

export function joinFailureReason(reply) {
    if (reply === undefined) return 'timeout';
    const code = typeof reply === 'object' && reply !== null ? reply.code : undefined;
    return code === 'ticket_invalid' || code === 'instance_unavailable' ? code : 'other';
}

export function requestResult(reply) {
    if (reply === undefined) return 'timeout';
    if (typeof reply !== 'object' || reply === null) return 'error';
    if (reply.success === true) return 'ok';
    return reply.code === 'migrating' || reply.code === 'conflict' ? reply.code : 'error';
}

export function parseFrame(raw) {
    if (typeof raw !== 'string') return null;
    try {
        const value = JSON.parse(raw);
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

// ---- 要約（10 秒ごとの 1 行） ----

const familyOf = (snapshot, suffix) => snapshot.find((f) => f.name === `ubichill_loadtest_${suffix}`);

const total = (snapshot, suffix, match = () => true) =>
    (familyOf(snapshot, suffix)?.series ?? []).filter((s) => match(s.labels)).reduce((acc, s) => acc + s.value, 0);

const ms = (seconds) => (seconds === null ? null : Math.round(seconds * 1000 * 10) / 10);

export function summarize(snapshot, previous, intervalSeconds, elapsedSeconds) {
    const cursor = familyOf(snapshot, 'cursor_latency_seconds')?.series[0]?.histogram ?? createHistogram();
    const join = familyOf(snapshot, 'join_seconds')?.series[0]?.histogram ?? createHistogram();
    const sent = total(snapshot, 'frames_sent_total');
    const received = total(snapshot, 'frames_received_total');
    const patch = (result) =>
        total(snapshot, 'requests_total', (l) => l.event === 'entity:patch' && l.result === result);
    return {
        type: 'summary',
        elapsed: Math.round(elapsedSeconds),
        connecting: total(snapshot, 'clients', (l) => l.state === 'connecting'),
        connected: total(snapshot, 'clients', (l) => l.state === 'joined'),
        closed: total(snapshot, 'clients', (l) => l.state === 'closed'),
        rooms: total(snapshot, 'rooms'),
        joinFail: total(snapshot, 'join_failures_total'),
        sentPerSec: Math.round((sent - total(previous, 'frames_sent_total')) / intervalSeconds),
        receivedPerSec: Math.round((received - total(previous, 'frames_received_total')) / intervalSeconds),
        cursorSamples: cursor.count,
        cursorP50Ms: ms(histogramQuantile(cursor, 0.5)),
        cursorP95Ms: ms(histogramQuantile(cursor, 0.95)),
        cursorP99Ms: ms(histogramQuantile(cursor, 0.99)),
        joinP95Ms: ms(histogramQuantile(join, 0.95)),
        patch: { ok: patch('ok'), migrating: patch('migrating'), error: patch('error'), timeout: patch('timeout') },
        disconnects: total(snapshot, 'disconnects_total'),
    };
}

// ---- ここから副作用（管理 API・WebSocket・HTTP サーバー） ----

const log = (entry) => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);

const sleep = (msec, signal) =>
    new Promise((resolve) => {
        const timer = setTimeout(resolve, msec);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        });
    });

const ownerUrl = (config, presence) =>
    typeof presence?.addr === 'string' && presence.addr !== '' ? `http://${presence.addr}` : config.instanceUrl;

async function adminRequest(config, url, method, body) {
    const response = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${config.adminToken}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const json = text === '' ? null : parseFrame(text);
    return { status: response.status, body: json, text };
}

/** 部屋を作る。Service 経由なので draining・満杯の Pod に当たれば 503 で返り、別の Pod を引き直す。 */
async function createRoom(config, id, attempt = 1) {
    const definition = {
        id,
        name: id,
        maxUsers: config.maxUsersPerRoom,
        snapshot: { activeMods: [], availableComponents: [], entities: [], environment: {} },
    };
    const result = await adminRequest(
        config,
        `${config.instanceUrl}/realtime/v1/instances/${id}`,
        'PUT',
        definition,
    ).catch((error) => ({ status: 0, body: null, text: String(error) }));
    if (result.status === 200 && result.body) return { id, owner: ownerUrl(config, result.body) };
    if ((result.status === 503 || result.status === 0) && attempt < ADMIN_RETRIES) {
        await sleep(1000 * attempt);
        return createRoom(config, id, attempt + 1);
    }
    log({ type: 'error', what: 'createRoom', id, status: result.status, body: result.text.slice(0, 300) });
    return null;
}

async function issueTicket(config, room, userId) {
    const result = await adminRequest(config, `${room.owner}/realtime/v1/instances/${room.id}/tickets`, 'POST', {
        userId,
    }).catch((error) => ({ status: 0, body: null, text: String(error) }));
    return result.status === 200 && typeof result.body?.token === 'string' ? result.body.token : null;
}

async function deleteRoom(config, room) {
    const result = await adminRequest(config, `${room.owner}/realtime/v1/instances/${room.id}`, 'DELETE').catch(
        (error) => ({ status: 0, body: null, text: String(error) }),
    );
    if (result.status >= 300 || result.status === 0) {
        log({ type: 'error', what: 'deleteRoom', id: room.id, status: result.status, body: result.text.slice(0, 300) });
    }
}

const socketUrl = (config) => `${config.instanceUrl.replace(/^http/, 'ws')}/realtime/v1/ws`;

/**
 * 1 つの利用者。開く → world:join → world:snapshot → カーソル（active のみ）と、1 人目なら entity/state の要求。
 * 戻り値は停止用。失敗の理由はすべて指標に入れ、例外は投げない。
 */
function startClient({ config, registry, room, spec, token, timers, signal }) {
    const pending = new Map();
    const openedAt = performance.now();
    const ws = new WebSocket(socketUrl(config));
    const state = { current: 'connecting', joined: false };
    registry.inc('clients', { state: 'connecting' }, 1);

    const moveTo = (next) => {
        registry.inc('clients', { state: state.current }, -1);
        registry.inc('clients', { state: next }, 1);
        state.current = next;
    };
    const send = (event, data, id) => {
        if (ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(id === undefined ? { event, data } : { event, id, data }));
        registry.inc('frames_sent_total', { event }, 1);
        return true;
    };
    const request = (event, data) =>
        new Promise((resolve) => {
            const id = `${spec.userId}:${pending.size}:${Math.random().toString(36).slice(2, 8)}`;
            const timer = setTimeout(() => {
                pending.delete(id);
                resolve(undefined);
            }, REQUEST_TIMEOUT_MS);
            pending.set(id, (reply) => {
                clearTimeout(timer);
                resolve(reply);
            });
            if (!send(event, data, id)) {
                clearTimeout(timer);
                pending.delete(id);
                resolve({ success: false, error: 'socket not open' });
            }
        });
    const every = (msec, fn) => {
        const timer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) fn();
        }, msec);
        timers.add(timer);
        return timer;
    };

    const joinTimer = setTimeout(() => {
        if (state.joined) return;
        registry.inc('join_failures_total', { reason: 'timeout' }, 1);
        ws.close(1000, 'join timeout');
    }, JOIN_TIMEOUT_MS);
    timers.add(joinTimer);

    const startCursor = () => {
        const position = () =>
            spec.role === 'sender'
                ? { x: stampOf(Date.now()), y: Math.floor(Math.random() * 1000) }
                : { x: Math.floor(Math.random() * 1000), y: Math.floor(Math.random() * 1000) };
        every(1000 / config.cursorHz, () => send('cursor:move', { position: position() }));
    };

    const tracked = async (event, data) => {
        const reply = await request(event, data);
        const result = requestResult(reply);
        registry.inc('requests_total', { event, result }, 1);
        if (result !== 'migrating' || signal.aborted) return reply;
        await sleep(MIGRATING_RETRY_MS, signal);
        const retried = await request(event, data);
        registry.inc('requests_total', { event, result: requestResult(retried) }, 1);
        return retried;
    };

    const startRoomWriter = async () => {
        await tracked('state:update', { key: 'loadtest', value: { n: 1 }, expectedRevision: 0 });
        const created = await tracked('entity:create', {
            type: 'loadtest:box',
            transform: { x: 0, y: 0, z: 0, w: 10, h: 10, scale: 1, rotation: 0 },
            data: { n: 0 },
        });
        const entityId = created?.success === true ? created.entity?.id : undefined;
        if (typeof entityId !== 'string' || config.patchIntervalSeconds <= 0) return;
        const counter = { n: 0 };
        every(config.patchIntervalSeconds * 1000, () => {
            counter.n += 1;
            void tracked('entity:patch', { entityId, patch: { data: { n: counter.n } } });
        });
    };

    ws.addEventListener('open', () => {
        send(
            'world:join',
            {
                instanceId: room.id,
                token,
                user: { name: spec.name, status: 'online', position: { x: 0, y: 0 } },
            },
            `join:${spec.userId}`,
        );
    });
    ws.addEventListener('message', (message) => {
        const frame = parseFrame(message.data);
        if (!frame) return;
        if (typeof frame.replyTo === 'string') {
            registry.inc('frames_received_total', { event: 'reply' }, 1);
            if (frame.replyTo === `join:${spec.userId}` && frame.data?.success !== true) {
                registry.inc('join_failures_total', { reason: joinFailureReason(frame.data) }, 1);
                ws.close(1000, 'join failed');
                return;
            }
            pending.get(frame.replyTo)?.(frame.data);
            pending.delete(frame.replyTo);
            return;
        }
        const event = typeof frame.event === 'string' ? frame.event : 'unknown';
        registry.inc('frames_received_total', { event }, 1);
        if (event === 'world:snapshot' && !state.joined) {
            state.joined = true;
            clearTimeout(joinTimer);
            registry.observe('join_seconds', {}, (performance.now() - openedAt) / 1000);
            moveTo('joined');
            if (spec.active && config.cursorHz > 0) startCursor();
            if (spec.index === 0) void startRoomWriter();
            return;
        }
        if (event === 'cursor:moved' && spec.role === 'receiver') {
            const data = frame.data;
            if (data?.userId === spec.senderId && typeof data.position?.x === 'number') {
                registry.observe('cursor_latency_seconds', {}, latencySecondsFromStamp(data.position.x, Date.now()));
            }
            return;
        }
        if (event === 'server:notice') {
            registry.inc('notices_total', { kind: String(frame.data?.kind ?? 'unknown') }, 1);
        }
    });
    ws.addEventListener('close', (event) => {
        registry.inc('disconnects_total', { code: String(event.code) }, 1);
        if (!state.joined && !signal.aborted && state.current === 'connecting' && event.code !== 1000) {
            registry.inc('join_failures_total', { reason: 'other' }, 1);
        }
        clearTimeout(joinTimer);
        for (const resolve of pending.values()) resolve({ success: false, error: 'closed' });
        pending.clear();
        moveTo('closed');
    });
    // error のあとは必ず close が来るので、数えるのは close だけ
    ws.addEventListener('error', () => undefined);

    return { close: () => ws.readyState < WebSocket.CLOSING && ws.close(1000, 'done') };
}

function startMetricsServer(registry, port, onError) {
    const server = createServer((request, response) => {
        if (request.url !== '/metrics') {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        response.end(registry.render());
    });
    server.on('error', onError);
    server.listen(port, '0.0.0.0');
    return server;
}

async function main() {
    const config = parseConfig(process.env);
    const errors = validateConfig(config);
    if (errors.length > 0) {
        log({ type: 'fatal', errors });
        process.exit(2);
    }
    const registry = createRegistry(config.scenario);
    registry.set(
        'info',
        {
            rooms_per_worker: config.roomsPerWorker,
            users_per_room: config.usersPerRoom,
            cursor_hz: config.cursorHz,
            active_ratio: config.activeRatio,
        },
        1,
    );
    const server = startMetricsServer(registry, config.metricsPort, (error) => {
        log({ type: 'fatal', errors: [`metrics server: ${error.message}`] });
        process.exit(1);
    });
    const controller = new AbortController();
    const timers = new Set();
    const clients = new Set();
    const startedAt = performance.now();
    const elapsed = () => (performance.now() - startedAt) / 1000;

    const suffix = workerSuffix(config.podName);
    const ids = roomIds(config.roomPrefix, suffix, config.roomsPerWorker);
    log({
        type: 'start',
        pod: config.podName,
        suffix,
        rooms: ids.length,
        clientsPlanned: ids.length * config.usersPerRoom,
    });

    const rooms = (await Promise.all(ids.map((id) => createRoom(config, id)))).filter((room) => room !== null);
    registry.set('rooms', {}, rooms.length);
    if (rooms.length === 0) {
        log({ type: 'fatal', errors: ['部屋を 1 つも作れなかった'] });
        server.close();
        process.exit(1);
    }
    const byId = new Map(rooms.map((room) => [room.id, room]));
    const plan = planClients(
        config,
        rooms.map((room) => room.id),
    );
    const schedule = rampSchedule(plan.length, config.rampSeconds * 1000);

    const summary = { previous: registry.snapshot() };
    const summaryTimer = setInterval(() => {
        const snapshot = registry.snapshot();
        log(summarize(snapshot, summary.previous, SUMMARY_INTERVAL_MS / 1000, elapsed()));
        summary.previous = snapshot;
    }, SUMMARY_INTERVAL_MS);
    timers.add(summaryTimer);

    const launch = async (spec, delayMs) => {
        await sleep(delayMs, controller.signal);
        if (controller.signal.aborted) return;
        const room = byId.get(spec.roomId);
        const token = await issueTicket(config, room, spec.userId);
        if (token === null) {
            registry.inc('join_failures_total', { reason: 'other' }, 1);
            return;
        }
        if (controller.signal.aborted) return;
        const client = startClient({
            config,
            registry,
            room,
            spec,
            token,
            timers,
            signal: controller.signal,
        });
        clients.add(client);
    };

    const shutdown = async (reason) => {
        if (controller.signal.aborted) return;
        log({ type: 'stopping', reason, elapsed: Math.round(elapsed()) });
        controller.abort();
        for (const timer of timers) clearInterval(timer);
        for (const client of clients) client.close();
        await sleep(500);
        await Promise.all(rooms.map((room) => deleteRoom(config, room)));
        log(summarize(registry.snapshot(), summary.previous, SUMMARY_INTERVAL_MS / 1000, elapsed()));
        // 終わった直後の値（closed・disconnects）を Prometheus が拾えるよう、時間切れのときは /metrics を残す。
        // SIGTERM は Pod の削除なので待たない
        const hold = reason === 'duration' ? config.holdSeconds : 0;
        log({ type: 'done', reason, holdSeconds: hold });
        await sleep(hold * 1000);
        server.close();
        setTimeout(() => process.exit(0), 200).unref();
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    const durationTimer = setTimeout(() => void shutdown('duration'), config.durationSeconds * 1000);
    timers.add(durationTimer);
    await Promise.all(plan.map((spec, i) => launch(spec, schedule[i])));
}

// ConfigMap のマウントはシンボリックリンク（/loadgen/loadgen.mjs → ..data/loadgen.mjs）。import.meta.url は実体のパスになるので realpath で比べる
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    main().catch((error) => {
        log({ type: 'fatal', errors: [String(error?.stack ?? error)] });
        process.exit(1);
    });
}
