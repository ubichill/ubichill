// node --test charts/ubichill-loadtest/files/loadgen.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    activeClientCount,
    createHistogram,
    createRegistry,
    histogramQuantile,
    isProductionTarget,
    joinFailureReason,
    LATENCY_BUCKETS,
    latencySecondsFromStamp,
    observeHistogram,
    parseConfig,
    parseFrame,
    planClients,
    rampSchedule,
    renderLabels,
    renderMetrics,
    requestResult,
    roomIds,
    stampOf,
    summarize,
    validateConfig,
    workerSuffix,
} from './loadgen.mjs';

const validEnv = {
    LOADTEST_INSTANCE_URL: 'http://ubichill-dev-instance:3002/',
    LOADTEST_ADMIN_TOKEN: 'token',
    POD_NAME: 'loadtest-abcde-k9x2q',
};

describe('parseConfig / validateConfig', () => {
    it('既定値を埋め、末尾の / を落とし、定員は usersPerRoom + 5', () => {
        const config = parseConfig(validEnv);
        assert.equal(config.instanceUrl, 'http://ubichill-dev-instance:3002');
        assert.equal(config.scenario, 'default');
        assert.equal(config.cursorHz, 20);
        assert.equal(config.activeRatio, 0.3);
        assert.equal(config.rampSeconds, 30);
        assert.equal(config.patchIntervalSeconds, 5);
        assert.equal(config.usersPerRoom, 10);
        assert.equal(config.maxUsersPerRoom, 15);
        assert.deepEqual(validateConfig(config), []);
    });

    it('空文字・数値でない値は既定にし、明示した定員は尊重する', () => {
        const config = parseConfig({
            ...validEnv,
            LOADTEST_CURSOR_HZ: '',
            LOADTEST_USERS_PER_ROOM: 'abc',
            LOADTEST_MAX_USERS_PER_ROOM: '50',
        });
        assert.equal(config.cursorHz, 20);
        assert.equal(config.usersPerRoom, 10);
        assert.equal(config.maxUsersPerRoom, 50);
    });

    it('本番の Service 名そのものは断る。dev の名前は通す', () => {
        assert.ok(isProductionTarget('http://ubichill-instance:3002'));
        assert.ok(isProductionTarget('http://ubichill-instance.ubichill.svc.cluster.local:3002'));
        assert.ok(!isProductionTarget('http://ubichill-dev-instance:3002'));
        assert.ok(!isProductionTarget('http://ubichill-instance-preview:3002'));
        assert.ok(!isProductionTarget('not a url'));
        const errors = validateConfig(
            parseConfig({ ...validEnv, LOADTEST_INSTANCE_URL: 'http://ubichill-instance:3002' }),
        );
        assert.equal(errors.length, 1);
        assert.match(errors[0], /本番/);
    });

    it('矛盾した条件はまとめて返す', () => {
        const errors = validateConfig(
            parseConfig({
                LOADTEST_INSTANCE_URL: 'ftp://x',
                LOADTEST_USERS_PER_ROOM: '20',
                LOADTEST_MAX_USERS_PER_ROOM: '10',
                LOADTEST_ACTIVE_RATIO: '1.5',
                LOADTEST_DURATION_SECONDS: '0',
                LOADTEST_ROOMS_PER_WORKER: '1.5',
                LOADTEST_SCENARIO: 'a b',
            }),
        );
        assert.equal(errors.length, 7, errors.join('\n'));
    });
});

describe('部屋と利用者の計画', () => {
    it('部屋 ID は <prefix>-<Pod 名の末尾>-<n>', () => {
        assert.equal(workerSuffix('loadtest-abcde-k9x2q'), 'k9x2q');
        assert.equal(workerSuffix('local'), 'local');
        assert.deepEqual(roomIds('lt', 'k9x2q', 3), ['lt-k9x2q-1', 'lt-k9x2q-2', 'lt-k9x2q-3']);
        assert.deepEqual(roomIds('lt', 'k9x2q', 0), []);
    });

    it('送る人数は四捨五入。ratio > 0 なら送り手の 1 人目を必ず含め、0 なら誰も送らない', () => {
        assert.equal(activeClientCount(10, 0.3), 3);
        assert.equal(activeClientCount(10, 0.34), 3);
        assert.equal(activeClientCount(10, 0.35), 4);
        assert.equal(activeClientCount(1, 0.3), 1);
        assert.equal(activeClientCount(2, 0.01), 1);
        assert.equal(activeClientCount(10, 0), 0);
        assert.equal(activeClientCount(10, 1), 10);
        assert.equal(activeClientCount(10, 5), 10);
    });

    it('ランプは均等で、最後の接続は ramp の終わりより前。ramp 0 は全員すぐ', () => {
        assert.deepEqual(rampSchedule(4, 4000), [0, 1000, 2000, 3000]);
        assert.deepEqual(rampSchedule(3, 0), [0, 0, 0]);
        assert.deepEqual(rampSchedule(1, 30000), [0]);
        assert.deepEqual(rampSchedule(0, 30000), []);
        const many = rampSchedule(1000, 30000);
        assert.equal(many[999], 29970);
        assert.ok(many.every((t, i) => i === 0 || t >= many[i - 1]));
    });

    it('利用者は部屋ごとに連番で、役割と送り手 ID を持つ', () => {
        const config = parseConfig({ ...validEnv, LOADTEST_USERS_PER_ROOM: '3', LOADTEST_ACTIVE_RATIO: '0.5' });
        const plan = planClients(config, ['r-1', 'r-2']);
        assert.equal(plan.length, 6);
        assert.deepEqual(
            plan.slice(0, 3).map((c) => [c.userId, c.role, c.active]),
            [
                ['r-1-u1', 'sender', true],
                ['r-1-u2', 'receiver', true],
                ['r-1-u3', 'member', false],
            ],
        );
        assert.equal(plan[4].senderId, 'r-2-u1');
        assert.equal(plan[4].roomId, 'r-2');
        assert.ok(plan.every((c) => c.name.length >= 1 && c.name.length <= 30));
        assert.equal(new Set(plan.map((c) => c.userId)).size, 6);
    });
});

describe('遅延', () => {
    it('時刻の下位桁の差を秒で返し、法を跨いでも正しい', () => {
        assert.equal(stampOf(1_700_000_012_345), 12_345);
        assert.equal(latencySecondsFromStamp(12_345, 1_700_000_012_370), 0.025);
        assert.equal(latencySecondsFromStamp(9_999_990, 1_700_010_000_005), 0.015);
        assert.equal(latencySecondsFromStamp(500, 1_700_000_000_500), 0);
    });
});

describe('ヒストグラム', () => {
    it('observe は元を変えず、累積の bucket と sum/count を出す', () => {
        const empty = createHistogram([0.1, 1]);
        const h = observeHistogram(observeHistogram(observeHistogram(empty, 0.05), 0.5), 7);
        assert.deepEqual(empty.counts, [0, 0]);
        assert.deepEqual(h.counts, [1, 2]);
        assert.equal(h.count, 3);
        assert.equal(h.sum, 7.55);
    });

    it('quantile は Prometheus と同じ補間。空なら null、超過は最後の bucket', () => {
        assert.equal(histogramQuantile(createHistogram(), 0.5), null);
        const h = [0.004, 0.004, 0.02, 0.02, 0.02, 0.02, 0.03, 0.03, 0.09, 4].reduce(
            observeHistogram,
            createHistogram(),
        );
        // rank 5 は 2 番目の bucket（0.01〜0.025、累積 2→6）の中: 0.01 + 0.015 * (5-2)/4
        assert.ok(Math.abs(histogramQuantile(h, 0.5) - 0.02125) < 1e-9);
        assert.ok(Math.abs(histogramQuantile(h, 0.9) - 0.1) < 1e-9);
        assert.equal(histogramQuantile(observeHistogram(createHistogram(), 100), 0.5), 5);
        assert.equal(histogramQuantile(observeHistogram(createHistogram([1]), 0.5), 0.5), 0.5);
    });
});

describe('指標の描画', () => {
    it('ラベルを escape し、空なら中括弧を付けない', () => {
        assert.equal(renderLabels({}), '');
        assert.equal(renderLabels({ a: 'x"y\\z\n', n: 1 }), '{a="x\\"y\\\\z\\n",n="1"}');
    });

    it('固定の指標名・ラベル・bucket を出す', () => {
        const registry = createRegistry('s1');
        registry.set('info', { rooms_per_worker: 2, users_per_room: 10, cursor_hz: 20, active_ratio: 0.3 }, 1);
        registry.inc('clients', { state: 'joined' }, 3);
        registry.inc('clients', { state: 'joined' }, -1);
        registry.set('rooms', {}, 2);
        registry.inc('join_failures_total', { reason: 'timeout' });
        registry.inc('requests_total', { event: 'entity:patch', result: 'migrating' }, 2);
        registry.inc('disconnects_total', { code: '1006' });
        registry.inc('notices_total', { kind: 'disconnect' });
        registry.observe('cursor_latency_seconds', {}, 0.03);
        registry.observe('cursor_latency_seconds', {}, 0.3);
        registry.observe('join_seconds', {}, 0.0045);
        const text = registry.render();
        const lines = text.split('\n');
        const has = (line) => assert.ok(lines.includes(line), `無い行: ${line}\n${text}`);
        has(
            'ubichill_loadtest_info{scenario="s1",rooms_per_worker="2",users_per_room="10",cursor_hz="20",active_ratio="0.3"} 1',
        );
        has('ubichill_loadtest_clients{scenario="s1",state="joined"} 2');
        has('ubichill_loadtest_clients{scenario="s1",state="connecting"} 0');
        has('ubichill_loadtest_clients{scenario="s1",state="closed"} 0');
        has('ubichill_loadtest_rooms{scenario="s1"} 2');
        has('ubichill_loadtest_join_failures_total{scenario="s1",reason="timeout"} 1');
        has('ubichill_loadtest_join_failures_total{scenario="s1",reason="ticket_invalid"} 0');
        has('ubichill_loadtest_frames_sent_total{scenario="s1",event="cursor:move"} 0');
        has('ubichill_loadtest_frames_received_total{scenario="s1",event="cursor:moved"} 0');
        has('ubichill_loadtest_requests_total{scenario="s1",event="entity:patch",result="migrating"} 2');
        has('ubichill_loadtest_requests_total{scenario="s1",event="state:update",result="conflict"} 0');
        has('ubichill_loadtest_disconnects_total{scenario="s1",code="1006"} 1');
        has('ubichill_loadtest_notices_total{scenario="s1",kind="disconnect"} 1');
        has('# TYPE ubichill_loadtest_cursor_latency_seconds histogram');
        has('ubichill_loadtest_cursor_latency_seconds_bucket{scenario="s1",le="0.025"} 0');
        has('ubichill_loadtest_cursor_latency_seconds_bucket{scenario="s1",le="0.05"} 1');
        has('ubichill_loadtest_cursor_latency_seconds_bucket{scenario="s1",le="0.5"} 2');
        has('ubichill_loadtest_cursor_latency_seconds_bucket{scenario="s1",le="+Inf"} 2');
        has('ubichill_loadtest_cursor_latency_seconds_sum{scenario="s1"} 0.33');
        has('ubichill_loadtest_cursor_latency_seconds_count{scenario="s1"} 2');
        has('ubichill_loadtest_join_seconds_bucket{scenario="s1",le="0.005"} 1');
        has('ubichill_loadtest_join_seconds_count{scenario="s1"} 1');
        has('# TYPE ubichill_loadtest_requests_total counter');
        assert.equal((text.match(/_bucket\{scenario="s1",le="/g) ?? []).length, (LATENCY_BUCKETS.length + 1) * 2);
        assert.ok(text.endsWith('\n'));
    });

    it('未定義の指標は投げる。histogram は family ごとに TYPE を 1 回だけ出す', () => {
        const registry = createRegistry('s');
        assert.throws(() => registry.inc('bogus_total'), /未定義/);
        const text = renderMetrics([
            {
                name: 'h',
                type: 'histogram',
                help: 'x',
                series: [{ labels: { a: '1' }, histogram: createHistogram([1]) }],
            },
        ]);
        assert.equal(
            text,
            '# HELP h x\n# TYPE h histogram\nh_bucket{a="1",le="1"} 0\nh_bucket{a="1",le="+Inf"} 0\nh_sum{a="1"} 0\nh_count{a="1"} 0\n',
        );
    });
});

describe('応答の分類', () => {
    it('world:join の失敗の理由', () => {
        assert.equal(joinFailureReason(undefined), 'timeout');
        assert.equal(joinFailureReason({ success: false, code: 'ticket_invalid' }), 'ticket_invalid');
        assert.equal(joinFailureReason({ success: false, code: 'instance_unavailable' }), 'instance_unavailable');
        assert.equal(joinFailureReason({ success: false, error: 'instance full' }), 'other');
        assert.equal(joinFailureReason('garbage'), 'other');
    });

    it('要求の結果', () => {
        assert.equal(requestResult(undefined), 'timeout');
        assert.equal(requestResult({ success: true, entity: {} }), 'ok');
        assert.equal(requestResult({ success: false, code: 'migrating' }), 'migrating');
        assert.equal(requestResult({ success: false, code: 'conflict', entry: {} }), 'conflict');
        assert.equal(requestResult({ success: false, error: '不正なパッチです' }), 'error');
        assert.equal(requestResult(null), 'error');
    });

    it('フレームはオブジェクトだけ通す', () => {
        assert.deepEqual(parseFrame('{"event":"x","data":1}'), { event: 'x', data: 1 });
        assert.equal(parseFrame('[1]'), null);
        assert.equal(parseFrame('{'), null);
        assert.equal(parseFrame(Buffer.from('{}')), null);
    });
});

describe('要約', () => {
    it('差分から sent/s を出し、分位は ms', () => {
        const registry = createRegistry('s');
        const before = registry.snapshot();
        registry.inc('frames_sent_total', { event: 'cursor:move' }, 200);
        registry.inc('frames_received_total', { event: 'cursor:moved' }, 1800);
        registry.inc('clients', { state: 'joined' }, 10);
        registry.set('rooms', {}, 1);
        registry.inc('join_failures_total', { reason: 'other' }, 2);
        registry.inc('requests_total', { event: 'entity:patch', result: 'ok' }, 3);
        registry.inc('requests_total', { event: 'entity:create', result: 'ok' }, 1);
        for (const v of [0.01, 0.01, 0.01, 0.01, 0.2]) registry.observe('cursor_latency_seconds', {}, v);
        const summary = summarize(registry.snapshot(), before, 10, 42.4);
        assert.equal(summary.type, 'summary');
        assert.equal(summary.elapsed, 42);
        assert.equal(summary.sentPerSec, 20);
        assert.equal(summary.receivedPerSec, 180);
        assert.equal(summary.connected, 10);
        assert.equal(summary.rooms, 1);
        assert.equal(summary.joinFail, 2);
        assert.equal(summary.cursorSamples, 5);
        assert.equal(summary.cursorP50Ms, 8.1);
        assert.equal(summary.cursorP99Ms, 242.5);
        assert.equal(summary.joinP95Ms, null);
        assert.deepEqual(summary.patch, { ok: 3, migrating: 0, error: 0, timeout: 0 });
    });
});
