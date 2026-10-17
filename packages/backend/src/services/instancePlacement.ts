import type { RedisCommands } from '../lib/redis';

/** Go の各 Pod が heartbeat で `ubi:node:<id>` に書く状態（services/instance/internal/coord の NodeInfo）。 */
export interface NodeLoad {
    id: string;
    addr: string;
    state: 'ready' | 'draining';
    rooms: number;
    connections: number;
    /** 持てる部屋の数の上限。0 なら上限を書いていない（古い版の Pod） */
    capacity: number;
}

const count = (value: unknown): number | null =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** `ubi:node:<id>` の値を読む。壊れている・知らない状態なら null（候補にしない）。 */
export function parseNodeLoad(id: string, value: string | null | undefined): NodeLoad | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const rooms = count(parsed.rooms);
        const connections = count(parsed.connections);
        const capacity = count(parsed.capacity ?? 0);
        if (typeof parsed.addr !== 'string' || !parsed.addr) return null;
        if (parsed.state !== 'ready' && parsed.state !== 'draining') return null;
        if (rooms === null || connections === null || capacity === null) return null;
        return { id, addr: parsed.addr, state: parsed.state, rooms, connections, capacity };
    } catch {
        return null;
    }
}

const hasRoom = (node: NodeLoad) => node.capacity === 0 || node.rooms < node.capacity;

/**
 * 部屋の作成を送る Pod の順番。今の owner が生きていればまず owner（draining でも持っている部屋は動き続け、
 * 作成は冪等に今の部屋を返す）。次に ready で上限に達していない Pod を、接続数・部屋数の少ない順に並べる。
 * heartbeat は 5 秒ごとなので数は少し古い。同じ間に作られた部屋は同じ Pod に寄るが、上限に達すれば Pod が 503 で断る。
 */
export function placementOrder(nodes: readonly NodeLoad[], owner?: string): NodeLoad[] {
    const current = nodes.find((node) => node.id === owner);
    const candidates = nodes
        .filter((node) => node.id !== owner && node.state === 'ready' && hasRoom(node))
        .sort((a, b) => a.connections - b.connections || a.rooms - b.rooms || a.id.localeCompare(b.id));
    return current ? [current, ...candidates] : candidates;
}

/** 置き場所を選ぶのに要る Redis の値（Go の Directory のキー。DIRECTORY_PREFIX と同じ名前空間）。 */
export interface PlacementView {
    nodes: NodeLoad[];
    owner?: string;
}

/**
 * `ubi:nodes` の一覧から生きている Pod の状態と、部屋の今の owner を読む。期限の切れた Pod は一覧から外す
 * （Go は heartbeat のたびに載せ直すので、外したあとに書き直されても次の heartbeat で戻る）。
 */
export async function readPlacement(client: RedisCommands, room: string, prefix: string): Promise<PlacementView> {
    const ids = (await client.sendCommand(['SMEMBERS', `${prefix}nodes`])) as string[];
    const owner = (await client.sendCommand(['HGET', `${prefix}room:${room}`, 'node'])) as string | null;
    if (ids.length === 0) return { nodes: [], owner: owner ?? undefined };
    const values = (await client.sendCommand(['MGET', ...ids.map((id) => `${prefix}node:${id}`)])) as (string | null)[];
    const expired = ids.filter((_, i) => !values[i]);
    if (expired.length > 0) await client.sendCommand(['SREM', `${prefix}nodes`, ...expired]);
    const nodes = ids.flatMap((id, i) => {
        const node = parseNodeLoad(id, values[i]);
        return node ? [node] : [];
    });
    return { nodes, owner: owner ?? undefined };
}
