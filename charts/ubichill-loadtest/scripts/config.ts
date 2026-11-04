// 試験の設定（env → 値）と k6 の options。k6 のモジュールに依存しない（vitest で確かめる）。
import { splitUrl } from './protocol.ts';

export type ScenarioKind = 'users' | 'browser';

export interface LoadTestConfig {
    readonly scenario: ScenarioKind;
    /** 走りの名前。全指標の testid タグになり、Grafana で走りを選ぶ鍵になる */
    readonly testId: string;
    /** 画面のオリジン（Origin ヘッダー・ブラウザの開き先・参加情報の相対 URL の基準） */
    readonly origin: string;
    /** backend の URL。クラスタ内なら http://<release>-backend:3001、Cloudflare 経由なら origin と同じ */
    readonly apiBase: string;
    /** 参加情報の WebSocket の URL のスキームとホストをこれに置き換える（クラスタ内の Go の Service）。null なら公開 URL のまま */
    readonly wsBase: string | null;
    readonly worldId: string;
    readonly rooms: number;
    readonly usersPerRoom: number;
    /** インスタンスの定員（settings.maxUsers）。ワールドの capacity.max で頭打ちになる */
    readonly maxUsersPerRoom: number;
    readonly cursorHz: number;
    readonly activeRatio: number;
    /** 各部屋の entity:patch・state:update の間隔。0 なら送らない */
    readonly patchIntervalSeconds: number;
    /** world:join で features: ["cursors:batch"] を宣言し、cursors:moved（まとめ送り）を受ける */
    readonly cursorBatch: boolean;
    readonly rampSeconds: number;
    readonly holdSeconds: number;
    /** アカウントの番号の起点。同時に 2 つ走らせるときは重ならないようにずらす（1 アカウント 1 接続） */
    readonly accountOffset: number;
    readonly accountPassword: string;
    readonly browserVus: number;
    readonly browserStartSeconds: number;
    readonly browserDurationSeconds: number;
    readonly browserPauseSeconds: number;
}

export type Env = Readonly<Record<string, string | undefined>>;

const numberOr = (value: string | undefined, fallback: number): number => {
    if (value === undefined || value.trim() === '') return fallback;
    const n = Number(value);
    return Number.isNaN(n) ? fallback : n;
};

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export function parseConfig(env: Env): LoadTestConfig {
    const origin = trimSlash(env.LT_ORIGIN ?? 'https://dev.ubichill.com');
    const usersPerRoom = numberOr(env.LT_USERS_PER_ROOM, 10);
    const rampSeconds = numberOr(env.LT_RAMP_SECONDS, 60);
    const holdSeconds = numberOr(env.LT_HOLD_SECONDS, 300);
    const wsBase = trimSlash(env.LT_WS_BASE ?? '');
    return {
        scenario: env.LT_SCENARIO === 'browser' ? 'browser' : 'users',
        testId: env.LT_TESTID ?? '',
        origin,
        apiBase: trimSlash(env.LT_API_BASE || origin),
        wsBase: wsBase === '' ? null : wsBase,
        worldId: env.LT_WORLD || 'default',
        rooms: numberOr(env.LT_ROOMS, 1),
        usersPerRoom,
        maxUsersPerRoom: numberOr(env.LT_MAX_USERS_PER_ROOM, usersPerRoom),
        cursorHz: numberOr(env.LT_CURSOR_HZ, 20),
        activeRatio: numberOr(env.LT_ACTIVE_RATIO, 0.3),
        patchIntervalSeconds: numberOr(env.LT_PATCH_INTERVAL_SECONDS, 5),
        cursorBatch: env.LT_CURSOR_BATCH === 'true',
        rampSeconds,
        holdSeconds,
        accountOffset: numberOr(env.LT_ACCOUNT_OFFSET, 0),
        accountPassword: env.LT_ACCOUNT_PASSWORD || 'loadtest-dev-password',
        browserVus: numberOr(env.LT_BROWSER_VUS, 1),
        browserStartSeconds: numberOr(env.LT_BROWSER_START_SECONDS, 0),
        browserDurationSeconds: numberOr(env.LT_BROWSER_DURATION_SECONDS, rampSeconds + holdSeconds),
        browserPauseSeconds: numberOr(env.LT_BROWSER_PAUSE_SECONDS, 30),
    };
}

// 本番の公開ホストと、本番の release（ubichill）の Service 名。chart の fail と二重に守る
const PRODUCTION_HOSTS: ReadonlySet<string> = new Set(['ubichill.com', 'www.ubichill.com']);
const PRODUCTION_SERVICES: readonly string[] = ['ubichill-backend', 'ubichill-instance', 'ubichill-frontend'];

export function isProductionTarget(url: string): boolean {
    const host = hostnameOf(url);
    if (host === null) return false;
    return PRODUCTION_HOSTS.has(host) || PRODUCTION_SERVICES.some((s) => host === s || host.startsWith(`${s}.`));
}

const hostnameOf = (url: string): string | null => splitUrl(url)?.hostname ?? null;

const isHttpUrl = (url: string): boolean => {
    const parts = splitUrl(url);
    return parts !== null && (parts.scheme === 'http' || parts.scheme === 'https');
};
const isInteger = (n: number, min: number, max = Number.MAX_SAFE_INTEGER): boolean =>
    Number.isInteger(n) && n >= min && n <= max;

/** 設定の誤り（日本語の文の並び）。空なら走らせてよい。 */
export function validateConfig(config: LoadTestConfig): string[] {
    const targets = [config.origin, config.apiBase, ...(config.wsBase === null ? [] : [config.wsBase])];
    const checks: readonly (readonly [boolean, string])[] = [
        [/^[A-Za-z0-9_.-]{1,63}$/.test(config.testId), 'LT_TESTID は英数字・-_. の 1〜63 文字（指標の testid タグ）'],
        [isHttpUrl(config.origin), 'LT_ORIGIN は http(s) の URL'],
        [isHttpUrl(config.apiBase), 'LT_API_BASE は http(s) の URL'],
        [config.wsBase === null || isHttpUrl(config.wsBase), 'LT_WS_BASE は http(s) の URL か空'],
        [!targets.some(isProductionTarget), '対象が本番（ubichill.com・ubichill-* の Service）を向いている'],
        [/^[A-Za-z0-9_.:/-]{1,200}$/.test(config.worldId), 'LT_WORLD はワールドの ID か URL'],
        [isInteger(config.rooms, 1, 100_000), 'LT_ROOMS は 1 以上の整数'],
        [isInteger(config.usersPerRoom, 1, 1000), 'LT_USERS_PER_ROOM は 1〜1000 の整数'],
        [
            isInteger(config.maxUsersPerRoom, config.usersPerRoom, 1000),
            'LT_MAX_USERS_PER_ROOM は LT_USERS_PER_ROOM 以上 1000 以下の整数',
        ],
        [config.cursorHz >= 0 && config.cursorHz <= 60, 'LT_CURSOR_HZ は 0〜60（Go は 1 接続 240 フレーム/秒まで）'],
        [config.activeRatio >= 0 && config.activeRatio <= 1, 'LT_ACTIVE_RATIO は 0〜1'],
        [config.patchIntervalSeconds >= 0, 'LT_PATCH_INTERVAL_SECONDS は 0 以上'],
        [isInteger(config.rampSeconds, 1), 'LT_RAMP_SECONDS は 1 以上の整数'],
        [isInteger(config.holdSeconds, 1), 'LT_HOLD_SECONDS は 1 以上の整数'],
        [isInteger(config.accountOffset, 0, 1_000_000_000), 'LT_ACCOUNT_OFFSET は 0 以上の整数'],
        [config.accountPassword.length >= 8, 'LT_ACCOUNT_PASSWORD は 8 文字以上'],
        [isInteger(config.browserVus, 1, 10), 'LT_BROWSER_VUS は 1〜10'],
        [isInteger(config.browserStartSeconds, 0), 'LT_BROWSER_START_SECONDS は 0 以上の整数'],
        [isInteger(config.browserDurationSeconds, 1), 'LT_BROWSER_DURATION_SECONDS は 1 以上の整数'],
        [config.browserPauseSeconds >= 0, 'LT_BROWSER_PAUSE_SECONDS は 0 以上'],
    ];
    return checks.filter(([ok]) => !ok).map(([, message]) => message);
}

export const totalUsers = (config: Pick<LoadTestConfig, 'rooms' | 'usersPerRoom'>): number =>
    config.rooms * config.usersPerRoom;

/** 退室（world:leave）とインスタンスの片付けに使う、hold のあとの猶予（秒） */
export const LEAVE_GRACE_SECONDS = 60;

// url は name と同じ値になる（k6 は name を指定すると url も揃える）。インスタンス ID を含む URL で系列を増やさない
const SYSTEM_TAGS = [
    'status',
    'method',
    'url',
    'name',
    'check',
    'error',
    'error_code',
    'scenario',
    'expected_response',
];

/**
 * arrival-rate は 0, T/N, 2T/N, ... に始めるので、duration が ramp ちょうどだと ramp の時刻に N+1 人目を始めようとする
 * （VU が足りず dropped_iterations に数えられる）。最後の人と N+1 人目の間で切る。
 */
export const rampDurationMs = (rampSeconds: number, total: number): number => {
    const rampMs = rampSeconds * 1000;
    return Math.round((rampMs - rampMs / Math.max(total, 1) / 2) * 1000) / 1000;
};

/** k6 の options。users は利用者の負荷、browser は画面の体験の確認（別の TestRun で走らせる）。 */
export function buildOptions(config: LoadTestConfig) {
    const common = {
        tags: { testid: config.testId },
        systemTags: SYSTEM_TAGS,
        setupTimeout: '60s',
        summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
    };
    if (config.scenario === 'browser') {
        return {
            ...common,
            scenarios: {
                browser: {
                    executor: 'constant-vus',
                    exec: 'browserJourney',
                    vus: config.browserVus,
                    duration: `${config.browserDurationSeconds}s`,
                    startTime: `${config.browserStartSeconds}s`,
                    gracefulStop: '120s',
                    options: { browser: { type: 'chromium' } },
                },
            },
        };
    }
    const total = totalUsers(config);
    // 1 回の iteration = 1 人の利用者。ramp の間に total 人を均等に始め、各自が「開始 + ramp + hold」まで部屋に居る
    return {
        ...common,
        scenarios: {
            users: {
                executor: 'constant-arrival-rate',
                exec: 'users',
                rate: total,
                timeUnit: `${config.rampSeconds}s`,
                duration: `${rampDurationMs(config.rampSeconds, total)}ms`,
                preAllocatedVUs: total,
                maxVUs: total,
                gracefulStop: `${config.holdSeconds + LEAVE_GRACE_SECONDS}s`,
            },
        },
    };
}
