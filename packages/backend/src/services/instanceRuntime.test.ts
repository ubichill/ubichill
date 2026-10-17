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

    it('redis が落ちていれば在席は失敗にする（reaper が空室と誤って消さない）', async () => {
        const sendCommand = vi.fn(async () => {
            throw new Error('The client is closed');
        });
        await expect(runtime('redis', fakeFetch().fetch, { sendCommand }).presence()).rejects.toThrow();
    });
});
