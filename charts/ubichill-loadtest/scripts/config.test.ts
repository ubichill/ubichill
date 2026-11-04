import { describe, expect, it } from 'vitest';
import {
    buildOptions,
    isProductionTarget,
    LEAVE_GRACE_SECONDS,
    parseConfig,
    rampDurationMs,
    validateConfig,
} from './config.ts';

const valid = { LT_TESTID: 'smoke-1104', LT_API_BASE: 'http://ubichill-dev-backend:3001' };

describe('parseConfig', () => {
    it('既定は dev の公開 URL・クラスタ内の向け直しなし・ワールド default', () => {
        const config = parseConfig({ LT_TESTID: 'a' });
        expect(config.origin).toBe('https://dev.ubichill.com');
        expect(config.apiBase).toBe('https://dev.ubichill.com');
        expect(config.wsBase).toBeNull();
        expect(config.worldId).toBe('default');
        expect(config.scenario).toBe('users');
        expect(config.cursorBatch).toBe(false);
    });

    it('末尾の / を落とし、空の LT_WS_BASE・LT_API_BASE は未指定と同じ', () => {
        const config = parseConfig({ LT_ORIGIN: 'https://dev.ubichill.com/', LT_API_BASE: '', LT_WS_BASE: '' });
        expect(config.origin).toBe('https://dev.ubichill.com');
        expect(config.apiBase).toBe('https://dev.ubichill.com');
        expect(config.wsBase).toBeNull();
    });

    it('定員の既定は 1 部屋の人数、ブラウザの時間の既定は ramp + hold', () => {
        const config = parseConfig({ LT_USERS_PER_ROOM: '12', LT_RAMP_SECONDS: '30', LT_HOLD_SECONDS: '90' });
        expect(config.maxUsersPerRoom).toBe(12);
        expect(config.browserDurationSeconds).toBe(120);
    });

    it('数にならない値は既定に戻す（NaN を素通りさせない）', () => {
        expect(parseConfig({ LT_ROOMS: 'many', LT_CURSOR_HZ: ' ' }).rooms).toBe(1);
        expect(parseConfig({ LT_CURSOR_HZ: ' ' }).cursorHz).toBe(20);
    });

    it('LT_CURSOR_BATCH は "true" だけを真にする', () => {
        expect(parseConfig({ LT_CURSOR_BATCH: 'true' }).cursorBatch).toBe(true);
        expect(parseConfig({ LT_CURSOR_BATCH: '1' }).cursorBatch).toBe(false);
    });
});

describe('validateConfig', () => {
    it('妥当な設定は誤りなし', () => {
        expect(validateConfig(parseConfig(valid))).toEqual([]);
    });

    it('testid が無い・空白を含むと断る（Grafana で走りを選べない）', () => {
        expect(validateConfig(parseConfig({ ...valid, LT_TESTID: '' }))).toHaveLength(1);
        expect(validateConfig(parseConfig({ ...valid, LT_TESTID: 'a b' }))).toHaveLength(1);
    });

    it.each([
        ['LT_ORIGIN', 'https://ubichill.com'],
        ['LT_ORIGIN', 'https://WWW.ubichill.com/'],
        ['LT_API_BASE', 'http://ubichill-backend:3001'],
        ['LT_API_BASE', 'http://ubichill-backend.ubichill.svc.cluster.local:3001'],
        ['LT_WS_BASE', 'http://ubichill-instance:3002'],
    ])('本番を向いた %s=%s は断る', (key, value) => {
        expect(validateConfig(parseConfig({ ...valid, [key]: value })).join()).toContain('本番');
    });

    it('URL でない対象は断る', () => {
        expect(validateConfig(parseConfig({ ...valid, LT_API_BASE: 'ubichill-dev-backend:3001' }))).toHaveLength(1);
        expect(validateConfig(parseConfig({ ...valid, LT_WS_BASE: 'ws://x:3002' }))).toHaveLength(1);
    });

    it('定員が 1 部屋の人数より少ないと断る', () => {
        const errors = validateConfig(parseConfig({ ...valid, LT_USERS_PER_ROOM: '10', LT_MAX_USERS_PER_ROOM: '9' }));
        expect(errors.join()).toContain('LT_MAX_USERS_PER_ROOM');
    });

    it('ramp 0 秒は断る（arrival-rate の duration に 0 は使えない）', () => {
        expect(validateConfig(parseConfig({ ...valid, LT_RAMP_SECONDS: '0' })).join()).toContain('LT_RAMP_SECONDS');
    });

    it('Go の 1 接続のフレームの上限に近いカーソルの頻度は断る', () => {
        expect(validateConfig(parseConfig({ ...valid, LT_CURSOR_HZ: '61' })).join()).toContain('LT_CURSOR_HZ');
    });
});

describe('isProductionTarget', () => {
    it('dev・プレビューの Service 名は本番ではない', () => {
        expect(isProductionTarget('http://ubichill-dev-backend:3001')).toBe(false);
        expect(isProductionTarget('http://ubichill-dev-instance:3002')).toBe(false);
        expect(isProductionTarget('https://pr-12.ubichill.com')).toBe(false);
        expect(isProductionTarget('https://dev.ubichill.com')).toBe(false);
    });

    it('本番の名前を前に含むだけの名前（ubichill-backend-x）は本番ではない', () => {
        expect(isProductionTarget('http://ubichill-backend-x:3001')).toBe(false);
    });

    it('URL として読めなければ本番とはみなさない（別の検査で落とす）', () => {
        expect(isProductionTarget('not a url')).toBe(false);
    });
});

describe('rampDurationMs', () => {
    it('最後の人（(N-1)T/N）は含め、N+1 人目（T）は含めない', () => {
        const cases: readonly (readonly [number, number])[] = [
            [300, 1000],
            [4, 8],
            [1, 1],
            [1, 5000],
        ];
        for (const [ramp, total] of cases) {
            const duration = rampDurationMs(ramp, total);
            expect(duration).toBeGreaterThan(((total - 1) * ramp * 1000) / total);
            expect(duration).toBeLessThan(ramp * 1000);
        }
    });
});

describe('buildOptions', () => {
    it('users は rooms × usersPerRoom 人を ramp の間に均等に始め、hold と退室の猶予まで待つ', () => {
        const options = buildOptions(
            parseConfig({
                ...valid,
                LT_ROOMS: '100',
                LT_USERS_PER_ROOM: '10',
                LT_RAMP_SECONDS: '300',
                LT_HOLD_SECONDS: '600',
            }),
        );
        expect(options.tags).toEqual({ testid: 'smoke-1104' });
        expect(options.scenarios).toEqual({
            users: expect.objectContaining({
                executor: 'constant-arrival-rate',
                exec: 'users',
                rate: 1000,
                timeUnit: '300s',
                duration: '299850ms',
                preAllocatedVUs: 1000,
                maxVUs: 1000,
                gracefulStop: `${600 + LEAVE_GRACE_SECONDS}s`,
            }),
        });
    });

    it('browser は Chromium の VU を開始の時刻から走らせ、利用者のシナリオは入れない', () => {
        const options = buildOptions(
            parseConfig({ ...valid, LT_SCENARIO: 'browser', LT_BROWSER_VUS: '2', LT_BROWSER_START_SECONDS: '300' }),
        );
        expect(Object.keys(options.scenarios)).toEqual(['browser']);
        expect(options.scenarios).toEqual({
            browser: expect.objectContaining({
                executor: 'constant-vus',
                exec: 'browserJourney',
                vus: 2,
                startTime: '300s',
                options: { browser: { type: 'chromium' } },
            }),
        });
    });

    it('URL のタグは系列を増やさないよう name と揃える前提で、instance_id などは足さない', () => {
        const options = buildOptions(parseConfig(valid));
        expect(options.systemTags).toContain('name');
        expect(options.systemTags).not.toContain('vu');
        expect(options.systemTags).not.toContain('iter');
    });
});
