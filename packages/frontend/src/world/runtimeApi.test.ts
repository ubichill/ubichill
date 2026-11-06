import { InstanceJoinRejected } from '@ubichill/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGuestResolver, fetchGuestInstance, isJoinRejection, presenceToInstance } from './runtimeApi';

const presence = { id: 'default', name: 'Room', maxUsers: 8, memberIds: ['a', 'b'], emptySince: 0 };
const grant = { token: 'ticket-1', userId: 'guest:1', expiresAt: 1, url: '/realtime/v1/ws', protocolVersion: 1 };

function memoryStore() {
    const raw = new Map<string, string>();
    return { raw, getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => void raw.set(k, v) };
}

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const queue = [...responses];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const next = queue.shift();
        if (!next) throw new Error(`unexpected fetch ${url}`);
        return new Response(JSON.stringify(next.body), { status: next.status });
    });
    vi.stubGlobal('fetch', fetch);
    return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('isJoinRejection', () => {
    it.each([401, 403, 404, 410, 422])('%i は再試行しても変わらない拒否', (status) => {
        expect(isJoinRejection(status)).toBe(true);
    });
    it.each([408, 429, 500, 502, 503, 504, 200, 302])('%i は拒否ではない', (status) => {
        expect(isJoinRejection(status)).toBe(false);
    });
});

describe('presenceToInstance', () => {
    it('同じオリジンなら接続先は相対パス、別オリジンならそのオリジンの ws', () => {
        expect(presenceToInstance(presence).connection.url).toBe('/realtime/v1/ws');
        expect(presenceToInstance(presence, 'https://go.example').connection.url).toBe(
            'https://go.example/realtime/v1/ws',
        );
    });
    it('在室人数は memberIds の数で、ゲストモードで空なら 0', () => {
        expect(presenceToInstance(presence).stats).toEqual({ currentUsers: 2, maxUsers: 8 });
        expect(presenceToInstance({ ...presence, memberIds: [] }).stats.currentUsers).toBe(0);
    });
    it('作者情報が無いので、署名済みとして扱わない（identity を付けない）', () => {
        const { world } = presenceToInstance(presence);
        expect(world.authorId).toBe('');
        expect('identity' in world).toBe(false);
    });
});

describe('createGuestResolver', () => {
    it('ゲストのチケットを取り、resumeToken を保存して次の解決で送る', async () => {
        const calls = stubFetch([
            { status: 200, body: grant },
            { status: 200, body: { ...grant, token: 'ticket-2' } },
        ]);
        const store = memoryStore();
        const resolve = createGuestResolver('', store);
        const first = await resolve('default');
        expect(first.url).toBe('/realtime/v1/ws');
        expect(calls[0]?.url).toBe('/realtime/v1/instances/default/guest');
        expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ resumeToken: '' });
        await resolve('default');
        expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ resumeToken: 'ticket-1' });
        expect(store.raw.get('ubichill:guest::default')).toBe('ticket-2');
    });

    it('別オリジンの Go なら接続先をそのオリジンにし、cookie は送らない', async () => {
        const calls = stubFetch([{ status: 200, body: grant }]);
        const resolved = await createGuestResolver('https://go.example', memoryStore())('r');
        expect(resolved.url).toBe('https://go.example/realtime/v1/ws');
        expect(calls[0]?.init?.credentials).toBe('omit');
    });

    it('4xx は入室拒否（再接続しない）、5xx は一時的な失敗', async () => {
        stubFetch([{ status: 404, body: { error: 'instance not found' } }]);
        await expect(createGuestResolver('', memoryStore())('x')).rejects.toBeInstanceOf(InstanceJoinRejected);
        stubFetch([{ status: 503, body: {} }]);
        const error = await createGuestResolver('', memoryStore())('x').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(InstanceJoinRejected);
    });
});

describe('fetchGuestInstance', () => {
    it('在席を Instance にし、無ければ失敗する', async () => {
        stubFetch([
            { status: 200, body: presence },
            { status: 404, body: {} },
        ]);
        expect((await fetchGuestInstance('', 'default')).world.displayName).toBe('Room');
        await expect(fetchGuestInstance('', 'missing')).rejects.toThrow('インスタンスが見つかりません');
    });
});
