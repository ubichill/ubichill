import type { ResolvedWorld } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
    appConfig: { runtime: { url: 'http://svc:3002', token: 't', publicUrl: '/ws', directory: 'memory' } },
}));
vi.mock('../lib/redis', () => ({ redis: null }));

import type { RedisCommands } from '../lib/redis';
import { createInstanceRuntime, type DirectoryMode, ownerBase, readRoomPresence } from './instanceRuntime';

const SERVICE = 'http://svc:3002';
const world = {
    displayName: 'World',
    initialEntities: [],
    environment: {},
    source: { kind: 'local' },
} as unknown as ResolvedWorld;

type Reply = { status: number; body?: unknown };

/** 呼ばれた URL・メソッドを記録し、決めた順に応答する fetch。 */
function fakeFetch(...replies: Reply[]) {
    const calls: { url: URL; method: string }[] = [];
    const queue = [...replies];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: new URL(String(input)), method: init?.method ?? 'GET' });
        const reply = queue.shift();
        if (!reply) throw new Error(`unexpected request ${String(input)}`);
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
    });
    return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const runtime = (directory: DirectoryMode, fetch: typeof globalThis.fetch, redis: RedisCommands | null = null) =>
    createInstanceRuntime({ url: SERVICE, token: 't', publicUrl: '/ws', directory, redis, fetch });

const presence = (addr: string) => ({
    id: 'room',
    name: 'room',
    maxUsers: 3,
    memberIds: [],
    emptySince: 0,
    node: 'node-a',
    gen: 'g1',
    epoch: 4,
    addr,
});
const conflict = (owner?: object) => ({ success: false, error: 'instance is owned by another node', owner });
const owner = (addr: string, alive = true, epoch = 4) => ({ node: 'node-b', gen: 'g1', epoch, addr, alive });
const grant = { token: 'ticket', userId: 'alice', expiresAt: 1, url: '/realtime/v1/ws', protocolVersion: 1 };

describe('ownerBase', () => {
    it('host:port だけを管理 API の宛先にする', () => {
        expect(ownerBase('10.0.0.7:3002')).toBe('http://10.0.0.7:3002');
        expect(ownerBase('[fd00::7]:3002')).toBe('http://[fd00::7]:3002');
        expect(ownerBase('pod-a.local:3002')).toBe('http://pod-a.local:3002');
    });
    it('パス・資格情報・スキーム・ポート無しを混ぜたアドレスには管理トークンを送らない', () => {
        for (const addr of [
            'evil.test:80/x',
            'user:pass@evil.test:80',
            'http://evil.test:80',
            'evil.test',
            'evil.test:80?x=1',
            '',
        ]) {
            expect(() => ownerBase(addr)).toThrow();
        }
    });
});

describe('readRoomPresence', () => {
    it('期限の切れた・壊れた在席は居ないものとして扱う', async () => {
        const sendCommand = vi.fn(async (args: ReadonlyArray<string>) => {
            if (args[0] === 'SMEMBERS') return ['a', 'expired', 'broken', 'wrong'];
            return [
                JSON.stringify({ members: ['alice', 1], emptySince: 0 }),
                null,
                '{not json',
                JSON.stringify({ members: 'alice', emptySince: 0 }),
            ];
        });
        const map = await readRoomPresence({ sendCommand }, 'p:');
        expect([...map.entries()]).toEqual([['a', { id: 'a', memberIds: ['alice'], emptySince: 0 }]]);
        expect(sendCommand).toHaveBeenLastCalledWith([
            'MGET',
            'p:presence:a',
            'p:presence:expired',
            'p:presence:broken',
            'p:presence:wrong',
        ]);
    });
    it('部屋が無ければ MGET を送らない', async () => {
        const sendCommand = vi.fn(async () => []);
        expect((await readRoomPresence({ sendCommand })).size).toBe(0);
        expect(sendCommand).toHaveBeenCalledTimes(1);
    });
});

describe('instanceRuntime', () => {
    it('memory: 割り当て・チケットとも Service へ送り、チケットに世代を付ける', async () => {
        const { fetch, calls } = fakeFetch({ status: 200, body: presence('host:3002') }, { status: 200, body: grant });
        const rt = runtime('memory', fetch);
        const to = await rt.provision('room', 3, world);
        expect(to).toEqual({ base: SERVICE, gen: 'g1', epoch: 4 });
        expect(await rt.ticket('room', 'alice', undefined, to)).toEqual({ ...grant, url: '/ws' });
        expect(calls[1].url.origin).toBe(SERVICE);
        expect(Object.fromEntries(calls[1].url.searchParams)).toEqual({ gen: 'g1', epoch: '4' });
    });

    it('redis: Service が割り当てた Pod へ、続くチケットを直接送る（Service は次に別の Pod へ当てる）', async () => {
        const { fetch, calls } = fakeFetch(
            { status: 200, body: presence('10.0.0.7:3002') },
            { status: 200, body: grant },
        );
        const rt = runtime('redis', fetch);
        await rt.ticket('room', 'alice', 'Alice', await rt.provision('room', 3, world));
        expect(calls.map((c) => `${c.method} ${c.url.origin}${c.url.pathname}`)).toEqual([
            `PUT ${SERVICE}/realtime/v1/instances/room`,
            'POST http://10.0.0.7:3002/realtime/v1/instances/room/tickets',
        ]);
    });

    it('PUT の 409 は成功扱いにせず、生きている owner の Pod と世代を使う', async () => {
        const { fetch } = fakeFetch({ status: 409, body: conflict(owner('10.0.0.8:3002')) });
        expect(await runtime('redis', fetch).provision('room', 3, world)).toEqual({
            base: 'http://10.0.0.8:3002',
            gen: 'g1',
            epoch: 4,
        });
    });

    it('owner の heartbeat が切れていれば失敗にする（クライアントは入り直す）', async () => {
        const { fetch } = fakeFetch({ status: 409, body: conflict(owner('10.0.0.8:3002', false)) });
        await expect(runtime('redis', fetch).provision('room', 3, world)).rejects.toThrow();
    });

    it('チケットの間に owner が替わったら、新しい owner へ 1 回だけ送り直す', async () => {
        const first = { base: 'http://10.0.0.7:3002', gen: 'g1', epoch: 4 };
        const { fetch, calls } = fakeFetch(
            { status: 409, body: conflict(owner('10.0.0.8:3002', true, 5)) },
            { status: 200, body: grant },
        );
        await runtime('redis', fetch).ticket('room', 'alice', undefined, first);
        expect(calls[1].url.origin).toBe('http://10.0.0.8:3002');
        expect(calls[1].url.searchParams.get('epoch')).toBe('5');

        const again = fakeFetch(
            { status: 409, body: conflict(owner('10.0.0.8:3002', true, 5)) },
            { status: 409, body: conflict(owner('10.0.0.9:3002', true, 6)) },
        );
        await expect(runtime('redis', again.fetch).ticket('room', 'alice', undefined, first)).rejects.toThrow();
        expect(again.calls).toHaveLength(2);

        const gone = fakeFetch({ status: 409, body: conflict() });
        await expect(runtime('redis', gone.fetch).ticket('room', 'alice', undefined, first)).rejects.toThrow();
    });

    it('閉じる: 別の Pod が owner なら、その Pod へ世代と emptyBefore を付けて送り直す', async () => {
        const { fetch, calls } = fakeFetch({ status: 409, body: conflict(owner('10.0.0.8:3002')) }, { status: 204 });
        expect(await runtime('redis', fetch).close('room', 123)).toBe(true);
        expect(calls[1].method).toBe('DELETE');
        expect(calls[1].url.origin).toBe('http://10.0.0.8:3002');
        expect(Object.fromEntries(calls[1].url.searchParams)).toEqual({ emptyBefore: '123', gen: 'g1', epoch: '4' });
    });

    it('閉じる: owner の無い 409（在席がある・空いたばかり）と、owner 側の 409 は閉じなかったと返す', async () => {
        const occupied = fakeFetch({ status: 409, body: { success: false, error: 'occupied' } });
        expect(await runtime('redis', occupied.fetch).close('room', 1)).toBe(false);
        expect(occupied.calls).toHaveLength(1);
        const stale = fakeFetch(
            { status: 409, body: conflict(owner('10.0.0.8:3002')) },
            { status: 409, body: conflict(owner('10.0.0.8:3002', true, 5)) },
        );
        expect(await runtime('redis', stale.fetch).close('room')).toBe(false);
        expect(stale.calls).toHaveLength(2);
    });

    it('在席: redis は Redis を読み、Go の Service には問い合わせない。memory は Service に問い合わせる', async () => {
        const sendCommand = vi.fn(async (args: ReadonlyArray<string>) =>
            args[0] === 'SMEMBERS' ? ['room'] : [JSON.stringify({ members: ['alice'], emptySince: 0 })],
        );
        const none = fakeFetch();
        const fromRedis = await runtime('redis', none.fetch, { sendCommand }).presence();
        expect(fromRedis.get('room')?.memberIds).toEqual(['alice']);
        expect(none.calls).toHaveLength(0);

        const svc = fakeFetch({ status: 200, body: { instances: [presence('h:1')] } });
        expect((await runtime('memory', svc.fetch, { sendCommand }).presence()).has('room')).toBe(true);
        expect(svc.calls[0].url.href).toBe(`${SERVICE}/realtime/v1/instances`);
    });

    describe('redis: 置き場所', () => {
        const nodeValue = (addr: string, load: object = {}) =>
            JSON.stringify({ addr, startedAt: 1, state: 'ready', rooms: 0, connections: 0, capacity: 10, ...load });
        /** ubi:nodes・ubi:node:<id>・ubi:room:<id> を返す Redis。 */
        const directory = (nodes: Record<string, string | null>, owner: string | null = null) => ({
            sendCommand: vi.fn(async (args: ReadonlyArray<string>) => {
                if (args[0] === 'SMEMBERS') return Object.keys(nodes);
                if (args[0] === 'HGET') return owner;
                if (args[0] === 'MGET') return args.slice(1).map((key) => nodes[key.slice('ubi:node:'.length)] ?? null);
                return 1;
            }),
        });
        const quiet = { warn: vi.fn() };
        const placed = (fetch: typeof globalThis.fetch, redis: RedisCommands) =>
            createInstanceRuntime({
                url: SERVICE,
                token: 't',
                publicUrl: '/ws',
                directory: 'redis',
                redis,
                fetch,
                log: quiet,
            });
        const puts = (calls: { url: URL; method: string }[]) =>
            calls.filter((c) => c.method === 'PUT').map((c) => c.url.origin);

        it('Service ではなく、空いている Pod へ作成を送る', async () => {
            const redis = directory({
                busy: nodeValue('10.0.0.1:3002', { connections: 40, rooms: 2 }),
                idle: nodeValue('10.0.0.2:3002', { connections: 3, rooms: 5 }),
                draining: nodeValue('10.0.0.3:3002', { state: 'draining' }),
            });
            const { fetch, calls } = fakeFetch({ status: 200, body: presence('10.0.0.2:3002') });
            expect(await placed(fetch, redis).provision('room', 3, world)).toEqual({
                base: 'http://10.0.0.2:3002',
                gen: 'g1',
                epoch: 4,
            });
            expect(puts(calls)).toEqual(['http://10.0.0.2:3002']);
        });

        it('生きている owner が居れば、空いている Pod より先に owner へ送る', async () => {
            const redis = directory(
                { idle: nodeValue('10.0.0.2:3002'), owner: nodeValue('10.0.0.9:3002', { connections: 90 }) },
                'owner',
            );
            const { fetch, calls } = fakeFetch({ status: 200, body: presence('10.0.0.9:3002') });
            await placed(fetch, redis).provision('room', 3, world);
            expect(puts(calls)).toEqual(['http://10.0.0.9:3002']);
        });

        it('503（draining・上限）と応答なしは次の Pod へ送り直す', async () => {
            const redis = directory({
                a: nodeValue('10.0.0.1:3002'),
                b: nodeValue('10.0.0.2:3002', { connections: 1 }),
                c: nodeValue('10.0.0.3:3002', { connections: 2 }),
            });
            const replies: (Reply | Error)[] = [
                { status: 503, body: { success: false, error: 'node is draining' } },
                new TypeError('fetch failed'),
                { status: 200, body: presence('10.0.0.3:3002') },
            ];
            const calls: string[] = [];
            const fetch = vi.fn(async (input: string | URL | Request) => {
                calls.push(new URL(String(input)).origin);
                const reply = replies.shift();
                if (!reply || reply instanceof Error) throw reply ?? new Error('unexpected');
                return new Response(JSON.stringify(reply.body), { status: reply.status });
            }) as unknown as typeof globalThis.fetch;
            expect((await placed(fetch, redis).provision('room', 3, world)).base).toBe('http://10.0.0.3:3002');
            expect(calls).toEqual(['http://10.0.0.1:3002', 'http://10.0.0.2:3002', 'http://10.0.0.3:3002']);
        });

        it('送り直すのは 3 つの Pod まで。全部に断られたら失敗にする', async () => {
            const nodes = Object.fromEntries(
                ['a', 'b', 'c', 'd'].map((id, i) => [id, nodeValue(`10.0.0.${i + 1}:3002`, { connections: i })]),
            );
            const full = { status: 503, body: { success: false, error: 'node is at capacity' } };
            const { fetch, calls } = fakeFetch(full, full, full);
            await expect(placed(fetch, directory(nodes)).provision('room', 3, world)).rejects.toThrow('置ける Pod');
            expect(calls).toHaveLength(3);
        });

        it('400（閉じたばかりの部屋など）は送り直さない', async () => {
            const redis = directory({ a: nodeValue('10.0.0.1:3002'), b: nodeValue('10.0.0.2:3002') });
            const { fetch, calls } = fakeFetch({
                status: 400,
                body: { success: false, error: 'instance has been closed' },
            });
            await expect(placed(fetch, redis).provision('room', 3, world)).rejects.toThrow('400');
            expect(calls).toHaveLength(1);
        });

        it('owner が割り当てを解放せずに落ちた（409 で alive: false）なら、送り直さずに失敗にする（入室は 503 で取り直させる）', async () => {
            const redis = directory({ a: nodeValue('10.0.0.1:3002'), b: nodeValue('10.0.0.2:3002') });
            const { fetch, calls } = fakeFetch({ status: 409, body: conflict(owner('10.0.0.8:3002', false)) });
            await expect(placed(fetch, redis).provision('room', 3, world)).rejects.toThrow('owner が応答しません');
            expect(calls).toHaveLength(1);
        });

        it('Pod の状態が無い・壊れている・アドレスが不正・Redis に届かないときは Service に任せる', async () => {
            for (const redis of [
                directory({}),
                directory({ broken: '{', evil: nodeValue('evil.test:80/x') }),
                {
                    sendCommand: vi.fn(async () => {
                        throw new Error('The client is closed');
                    }),
                },
            ]) {
                const { fetch, calls } = fakeFetch({ status: 200, body: presence('10.0.0.7:3002') });
                await placed(fetch, redis).provision('room', 3, world);
                expect(puts(calls)).toEqual([SERVICE]);
            }
        });

        it('memory は Redis を読まずに Service へ送り、503 を送り直さない', async () => {
            const redis = directory({ a: nodeValue('10.0.0.1:3002') });
            const { fetch, calls } = fakeFetch({ status: 503, body: { success: false, error: 'node is draining' } });
            await expect(runtime('memory', fetch, redis).provision('room', 3, world)).rejects.toThrow();
            expect(puts(calls)).toEqual([SERVICE]);
            expect(redis.sendCommand).not.toHaveBeenCalled();
        });
    });

    it('redis が落ちていれば在席は失敗にする（reaper が空室と誤って消さない）', async () => {
        const sendCommand = vi.fn(async () => {
            throw new Error('The client is closed');
        });
        await expect(runtime('redis', fakeFetch().fetch, { sendCommand }).presence()).rejects.toThrow();
    });
});
