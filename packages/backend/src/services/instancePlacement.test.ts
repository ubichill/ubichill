import { describe, expect, it, vi } from 'vitest';
import { type NodeLoad, parseNodeLoad, placementOrder, readPlacement } from './instancePlacement';

const node = (id: string, load: Partial<NodeLoad> = {}): NodeLoad => ({
    id,
    addr: `${id}:3002`,
    state: 'ready',
    rooms: 0,
    connections: 0,
    capacity: 10,
    ...load,
});
const ids = (nodes: NodeLoad[]) => nodes.map((n) => n.id);

describe('placementOrder', () => {
    it('接続数の少ない順、同じなら部屋数の少ない順、それも同じならノード ID の順に並べる', () => {
        const nodes = [
            node('c', { connections: 5, rooms: 1 }),
            node('a', { connections: 1, rooms: 3 }),
            node('b', { connections: 1, rooms: 2 }),
            node('d', { connections: 1, rooms: 2 }),
        ];
        expect(ids(placementOrder(nodes))).toEqual(['b', 'd', 'a', 'c']);
    });

    it('draining と上限に達した Pod には新しい部屋を置かない', () => {
        const nodes = [
            node('draining', { state: 'draining' }),
            node('full', { rooms: 10, capacity: 10 }),
            node('over', { rooms: 12, capacity: 10 }),
            node('busy', { connections: 900, rooms: 9 }),
        ];
        expect(ids(placementOrder(nodes))).toEqual(['busy']);
    });

    it('上限を書いていない Pod（capacity 0）は上限なしとして扱う', () => {
        expect(ids(placementOrder([node('old', { capacity: 0, rooms: 5000 })]))).toEqual(['old']);
    });

    it('生きている owner は draining・上限でも先頭に置き、二度は並べない', () => {
        const nodes = [node('idle'), node('owner', { state: 'draining', rooms: 10, connections: 99 })];
        expect(ids(placementOrder(nodes, 'owner'))).toEqual(['owner', 'idle']);
        expect(ids(placementOrder([node('idle'), node('owner', { connections: 50 })], 'owner'))).toEqual([
            'owner',
            'idle',
        ]);
    });

    it('owner が一覧に無い（heartbeat が切れた）なら空いている順だけ', () => {
        expect(ids(placementOrder([node('b', { connections: 2 }), node('a', { connections: 3 })], 'gone'))).toEqual([
            'b',
            'a',
        ]);
    });

    it('候補が無ければ空', () => {
        expect(placementOrder([])).toEqual([]);
        expect(placementOrder([node('x', { state: 'draining' })])).toEqual([]);
    });

    it('元の配列を並べ替えない', () => {
        const nodes = [node('b', { connections: 2 }), node('a', { connections: 1 })];
        placementOrder(nodes);
        expect(ids(nodes)).toEqual(['b', 'a']);
    });
});

describe('parseNodeLoad', () => {
    it('Go の NodeInfo を読む', () => {
        const value =
            '{"addr":"10.0.0.1:3002","startedAt":1,"state":"draining","rooms":2,"connections":3,"capacity":50}';
        expect(parseNodeLoad('n', value)).toEqual({
            id: 'n',
            addr: '10.0.0.1:3002',
            state: 'draining',
            rooms: 2,
            connections: 3,
            capacity: 50,
        });
    });

    it('capacity の無い古い Pod は上限 0（上限なし）', () => {
        expect(parseNodeLoad('n', '{"addr":"h:1","state":"ready","rooms":1,"connections":0}')?.capacity).toBe(0);
    });

    it('壊れた値・知らない状態・負の数・アドレスの無い Pod は候補にしない', () => {
        for (const value of [
            null,
            undefined,
            '',
            '{not json',
            '[]',
            '{"addr":"h:1","state":"stopping","rooms":0,"connections":0}',
            '{"addr":"h:1","state":"ready","rooms":-1,"connections":0}',
            '{"addr":"h:1","state":"ready","rooms":1.5,"connections":0}',
            '{"addr":"h:1","state":"ready","rooms":"1","connections":0}',
            '{"addr":"","state":"ready","rooms":0,"connections":0}',
            '{"state":"ready","rooms":0,"connections":0}',
        ]) {
            expect(parseNodeLoad('n', value)).toBeNull();
        }
    });
});

describe('readPlacement', () => {
    it('一覧の Pod を読み、期限の切れた Pod を一覧から外し、owner を返す', async () => {
        const sendCommand = vi.fn(async (args: ReadonlyArray<string>) => {
            switch (args[0]) {
                case 'SMEMBERS':
                    return ['a', 'expired', 'broken'];
                case 'HGET':
                    return 'a';
                case 'MGET':
                    return ['{"addr":"a:1","state":"ready","rooms":0,"connections":0,"capacity":5}', null, '{'];
                default:
                    return 1;
            }
        });
        const view = await readPlacement({ sendCommand }, 'room', 'p:');
        expect(view).toEqual({
            owner: 'a',
            nodes: [{ id: 'a', addr: 'a:1', state: 'ready', rooms: 0, connections: 0, capacity: 5 }],
        });
        expect(sendCommand).toHaveBeenCalledWith(['HGET', 'p:room:room', 'node']);
        expect(sendCommand).toHaveBeenCalledWith(['MGET', 'p:node:a', 'p:node:expired', 'p:node:broken']);
        // 壊れた値は書いた Pod が次に直すので外さない。期限の切れた Pod だけを外す
        expect(sendCommand).toHaveBeenCalledWith(['SREM', 'p:nodes', 'expired']);
    });

    it('Pod が無ければ MGET を送らない。owner が居なければ undefined', async () => {
        const sendCommand = vi.fn(async (args: ReadonlyArray<string>) => (args[0] === 'SMEMBERS' ? [] : null));
        expect(await readPlacement({ sendCommand }, 'room', 'p:')).toEqual({ nodes: [], owner: undefined });
        expect(sendCommand.mock.calls.map(([args]) => args[0])).toEqual(['SMEMBERS', 'HGET']);
    });
});
