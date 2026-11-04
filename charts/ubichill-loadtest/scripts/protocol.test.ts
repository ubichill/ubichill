import { describe, expect, it } from 'vitest';
import {
    accountStep,
    capacityProblem,
    cookieHeader,
    createdEntityId,
    cursorPosition,
    cursorStamps,
    encodeFrame,
    findTaggedInstance,
    findWorld,
    instanceIdFromUrl,
    joinFailure,
    joinGrant,
    joinRetryDelay,
    LATENCY_MARK_Y,
    latencyMs,
    MAX_MIGRATING_RETRIES,
    migratingRetryDelay,
    nextRevision,
    noticeKind,
    parseFrame,
    requestResult,
    resolveSocketUrl,
    STAMP_MODULO,
    splitUrl,
    stampOf,
} from './protocol.ts';

describe('フレーム', () => {
    it('要求は id 付き、通知は id なしで書く', () => {
        expect(JSON.parse(encodeFrame('state:get', { key: 'k' }, 'r1'))).toEqual({
            event: 'state:get',
            id: 'r1',
            data: { key: 'k' },
        });
        expect(JSON.parse(encodeFrame('cursor:move', { position: { x: 1, y: 2 } }))).not.toHaveProperty('id');
    });

    it('JSON でない・配列・文字列以外は null', () => {
        expect(parseFrame('{')).toBeNull();
        expect(parseFrame('[1]')).toBeNull();
        expect(parseFrame(new ArrayBuffer(1))).toBeNull();
        expect(parseFrame('{"replyTo":"r1","data":{"success":true}}')).toEqual({
            event: undefined,
            data: { success: true },
            id: undefined,
            replyTo: 'r1',
        });
    });
});

describe('応答の分類', () => {
    it('期限切れ・成功・引っ越し・競合・そのほか', () => {
        expect(requestResult(undefined)).toBe('timeout');
        expect(requestResult({ success: true })).toBe('ok');
        expect(requestResult({ success: false, code: 'migrating' })).toBe('migrating');
        expect(requestResult({ success: false, code: 'conflict', entry: null })).toBe('conflict');
        expect(requestResult({ success: false, error: '更新できません' })).toBe('error');
        expect(requestResult(null)).toBe('error');
        expect(requestResult('ok')).toBe('error');
    });

    it('success が真でなければ code があっても成功にしない', () => {
        expect(requestResult({ success: 'true', code: 'migrating' })).toBe('migrating');
        expect(requestResult({ success: 1 })).toBe('error');
    });

    it('入室の失敗のうち取り直せるものを見分ける', () => {
        expect(joinFailure(undefined)).toBe('timeout');
        expect(joinFailure({ success: false, code: 'ticket_invalid' })).toBe('ticket_invalid');
        expect(joinFailure({ success: false, code: 'instance_unavailable' })).toBe('instance_unavailable');
        expect(joinFailure({ success: false, error: '満員です' })).toBe('rejected');
    });
});

describe('再試行の判断', () => {
    it('migrating だけを 500ms 後に送り直し、上限で諦める', () => {
        expect(migratingRetryDelay('migrating', 0)).toBe(500);
        expect(migratingRetryDelay('migrating', MAX_MIGRATING_RETRIES - 1)).toBe(500);
        expect(migratingRetryDelay('migrating', MAX_MIGRATING_RETRIES)).toBeNull();
        expect(migratingRetryDelay('conflict', 0)).toBeNull();
        expect(migratingRetryDelay('timeout', 0)).toBeNull();
    });

    it('入室はチケットの取り直しで直るものだけ、間隔を延ばして 2 回まで', () => {
        expect(joinRetryDelay('ticket_invalid', 0)).toBe(500);
        expect(joinRetryDelay('instance_unavailable', 1)).toBe(1000);
        expect(joinRetryDelay('instance_unavailable', 2)).toBeNull();
        expect(joinRetryDelay('rejected', 0)).toBeNull();
        expect(joinRetryDelay('timeout', 0)).toBeNull();
    });
});

describe('カーソルの遅延', () => {
    it('時刻は Go の座標の上限（1e7）に収まる', () => {
        const stamp = stampOf(1_793_777_110_178);
        expect(stamp).toBeGreaterThanOrEqual(0);
        expect(stamp).toBeLessThan(STAMP_MODULO);
        expect(Number.isInteger(stampOf(1.5))).toBe(true);
    });

    it('遅延は送った時刻との差。法で一周したあとも正になる', () => {
        expect(latencyMs(stampOf(10_000), 10_042)).toBe(42);
        expect(latencyMs(STAMP_MODULO - 10, STAMP_MODULO + 5)).toBe(15);
    });

    it('1 人目は印の付いた位置、ほかの人は 0 以上の位置を送る', () => {
        expect(cursorPosition(true, 12_345, () => 0.5)).toEqual({ x: 12_345, y: LATENCY_MARK_Y });
        expect(cursorPosition(false, 12_345, () => 0.999)).toEqual({ x: 999, y: 999 });
    });

    it('cursor:moved（1 件）から 1 人目の時刻だけを取り出す', () => {
        expect(cursorStamps('cursor:moved', { userId: 'a', position: { x: 77, y: LATENCY_MARK_Y } })).toEqual([77]);
        expect(cursorStamps('cursor:moved', { userId: 'b', position: { x: 77, y: 0 } })).toEqual([]);
        expect(cursorStamps('cursor:moved', { userId: 'a' })).toEqual([]);
    });

    it('cursors:moved（まとめ送り）の中から印の付いたものをすべて取り出す', () => {
        const batch = [
            { userId: 'b', position: { x: 1, y: 2 } },
            { userId: 'a', position: { x: 50, y: LATENCY_MARK_Y }, heldEntityId: null },
            { userId: 'c', position: 'broken' },
            null,
        ];
        expect(cursorStamps('cursors:moved', batch)).toEqual([50]);
        expect(cursorStamps('cursors:moved', { userId: 'a' })).toEqual([]);
        expect(cursorStamps('users:update', batch)).toEqual([]);
    });
});

describe('知らせ', () => {
    it('server:notice は kind で数え、kind が無ければ unknown', () => {
        expect(noticeKind('server:notice', { kind: 'disconnect', at: 1 })).toBe('disconnect');
        expect(noticeKind('server:notice', 'x')).toBe('unknown');
        expect(noticeKind('session:replaced', undefined)).toBe('session_replaced');
        expect(noticeKind('instance:closing', 'bye')).toBe('instance_closing');
        expect(noticeKind('cursor:moved', {})).toBeNull();
    });
});

describe('共有状態の revision', () => {
    it('成功の応答・競合の応答・state:changed の entry から進める', () => {
        expect(nextRevision(0, { success: true, entry: { revision: 1 } })).toBe(1);
        expect(nextRevision(1, { success: false, code: 'conflict', entry: { revision: 4 } })).toBe(4);
        expect(nextRevision(4, { key: 'loadtest', revision: 5, value: {} })).toBe(5);
    });

    it('古い state:changed が後から届いても戻さない', () => {
        expect(nextRevision(5, { key: 'loadtest', revision: 3 })).toBe(5);
    });

    it('期限切れ・壊れた応答では変えない', () => {
        expect(nextRevision(3, undefined)).toBe(3);
        expect(nextRevision(3, { success: false, error: 'x' })).toBe(3);
    });

    it('競合でキーが無い（entry: null）なら 0 から書き直す', () => {
        expect(nextRevision(3, { success: false, code: 'conflict', entry: null })).toBe(0);
    });

    it('entry:create の応答からエンティティの ID を取り出す', () => {
        expect(createdEntityId({ success: true, entity: { id: 'e1' } })).toBe('e1');
        expect(createdEntityId({ success: false, entity: { id: 'e1' } })).toBeNull();
        expect(createdEntityId(undefined)).toBeNull();
    });
});

describe('URL', () => {
    it('絶対 URL を分ける（userinfo・ポート・IPv6）', () => {
        expect(splitUrl('https://user:pw@Dev.Ubichill.com:8443/a?b#c')).toEqual({
            scheme: 'https',
            host: 'dev.ubichill.com:8443',
            hostname: 'dev.ubichill.com',
            rest: '/a?b#c',
        });
        expect(splitUrl('http://[::1]:3001')?.hostname).toBe('[::1]');
        expect(splitUrl('/realtime/v1/ws')).toBeNull();
        expect(splitUrl('http:///path')).toBeNull();
    });

    it('相対の参加情報の url は画面のオリジンが基準（INSTANCE_PUBLIC_URL の既定は /realtime/v1/ws）', () => {
        expect(resolveSocketUrl('/realtime/v1/ws', 'https://dev.ubichill.com', null)).toBe(
            'wss://dev.ubichill.com/realtime/v1/ws',
        );
    });

    it('wsBase を渡すとスキームとホストだけを置き換え、パスとクエリは残す', () => {
        expect(
            resolveSocketUrl(
                'wss://dev.ubichill.com/realtime/v1/ws?x=1',
                'https://dev.ubichill.com',
                'http://ubichill-dev-instance:3002',
            ),
        ).toBe('ws://ubichill-dev-instance:3002/realtime/v1/ws?x=1');
        expect(resolveSocketUrl('/realtime/v1/ws', 'https://dev.ubichill.com', 'https://lb.example')).toBe(
            'wss://lb.example/realtime/v1/ws',
        );
    });

    it('http(s) の絶対 URL は ws(s) にする', () => {
        expect(resolveSocketUrl('http://localhost:3002/realtime/v1/ws', 'http://localhost:3000', null)).toBe(
            'ws://localhost:3002/realtime/v1/ws',
        );
    });

    it('WebSocket にできないスキームは投げる', () => {
        expect(() => resolveSocketUrl('ftp://x/ws', 'https://dev.ubichill.com', null)).toThrow();
        expect(() => resolveSocketUrl('/ws', 'https://dev.ubichill.com', 'ftp://x')).toThrow();
    });

    it('インスタンスの画面の URL から ID を取り出す', () => {
        expect(instanceIdFromUrl('https://dev.ubichill.com/instance/a%20b?x=1')).toBe('a b');
        expect(instanceIdFromUrl('https://dev.ubichill.com/')).toBeNull();
    });
});

describe('Cookie とアカウント', () => {
    it('Secure の Cookie も含めて、同じ名前は最後の値を使う', () => {
        expect(
            cookieHeader({
                '__Secure-better-auth.session_token': [{ value: 'old' }, { value: 'tok' }],
                'better-auth.session_data': [{ value: 'data' }],
                cleared: [{ value: '' }],
                none: [],
            }),
        ).toBe('__Secure-better-auth.session_token=tok; better-auth.session_data=data');
    });

    it('ログインの状態から、そのまま進む・登録する・待つ・諦めるを決める', () => {
        expect(accountStep(200)).toBe('signed_in');
        expect(accountStep(401)).toBe('register');
        expect(accountStep(429)).toBe('rate_limited');
        expect(accountStep(500)).toBe('failed');
        expect(accountStep(0)).toBe('failed');
    });
});

describe('API の応答', () => {
    const instances = {
        instances: [
            { id: 'i1', access: { tags: ['other'] } },
            { id: 'i2', access: { tags: ['ltabcr1', 'x'] } },
            { id: 'i3' },
            'broken',
        ],
    };

    it('部屋の印の付いたインスタンスを探す', () => {
        expect(findTaggedInstance(instances, 'ltabcr1')).toBe('i2');
        expect(findTaggedInstance(instances, 'ltabcr10')).toBeNull();
        expect(findTaggedInstance({ error: 'x' }, 'ltabcr1')).toBeNull();
    });

    it('参加情報は token と url の両方が要る', () => {
        expect(joinGrant({ token: 't', url: '/realtime/v1/ws' })).toEqual({ token: 't', url: '/realtime/v1/ws' });
        expect(joinGrant({ token: 't' })).toBeNull();
    });

    it('ワールドは id か url で探し、定員を読む', () => {
        const worlds = {
            worlds: [
                {
                    id: 'default',
                    url: 'https://x/worlds/default.yaml',
                    displayName: 'Ubichill Home',
                    capacity: { default: 10, max: 20 },
                },
            ],
        };
        expect(findWorld(worlds, 'default')).toEqual({ id: 'default', displayName: 'Ubichill Home', capacityMax: 20 });
        expect(findWorld(worlds, 'https://x/worlds/default.yaml')?.id).toBe('default');
        expect(findWorld(worlds, 'danmaku')).toBeNull();
    });

    it('1 部屋の人数がワールドの定員を超えると、走らせる前に止める', () => {
        const world = { id: 'default', displayName: 'Home', capacityMax: 20 };
        expect(capacityProblem(world, 20)).toBeNull();
        expect(capacityProblem(world, 50)).toContain('capacity.max');
    });
});
