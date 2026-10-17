import type { InstanceAPI, ResolvedWorld } from '@ubichill/shared';
import { appConfig } from '../config';
import { type RedisCommands, redis } from '../lib/redis';
import { logger } from '../utils/logger';
import { flattenGameObject } from './flattenGameObject';
import { placementOrder, readPlacement } from './instancePlacement';

export type RuntimePresence = InstanceAPI['schemas']['RuntimePresence'];
export type RuntimeGrant = InstanceAPI['schemas']['InstanceGrant'];
type RuntimeConflict = InstanceAPI['schemas']['Conflict'];
type RuntimeOwnerInfo = InstanceAPI['schemas']['InstanceOwner'];

/** 一覧・入室の判定・reaper が使う在席。Redis から読むときは名前・定員が無い。 */
export type RoomPresence = Pick<RuntimePresence, 'id' | 'memberIds' | 'emptySince' | 'gen' | 'epoch'>;

/** 部屋の owner の管理 API の宛先と、呼び出しに付ける世代（Go は世代が合わなければ 409 を返す）。 */
export interface RuntimeOwner {
    base: string;
    gen?: string;
    epoch?: number;
}

export type DirectoryMode = 'memory' | 'redis';

export interface InstanceRuntimeOptions {
    /** INSTANCE_RUNTIME_URL（Service）。memory では全部ここへ送る。redis では置き場所を選べないときの作成と、終了の最初の 1 回 */
    url: string;
    token: string;
    publicUrl: string;
    directory: DirectoryMode;
    redis: RedisCommands | null;
    fetch?: typeof fetch;
    log?: Pick<typeof logger, 'warn'>;
}

/** Go の Directory のキーの名前空間（services/instance/internal/coord の DirectoryFor と同じ）。 */
const DIRECTORY_PREFIX = 'ubi:';

/** 部屋の作成を送り直す Pod の数の上限（draining・上限・応答なしで断られたとき）。 */
const PLACEMENT_ATTEMPTS = 3;

// host:port だけを受け付ける。管理トークンを付けて送る先なので、パス・資格情報・スキームを混ぜさせない
const OWNER_ADDR = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/;

/**
 * owner の内部アドレス（Go の heartbeat の addr。POD_IP:待ち受けのポート）から管理 API の宛先を作る。
 * 管理 API と WebSocket は同じポートで待ち受け、Pod の間は平文（TLS は Ingress で終端する）。
 */
export function ownerBase(addr: string): string {
    if (!OWNER_ADDR.test(addr))
        throw new Error(`Instance runtime: owner のアドレスが不正です (${JSON.stringify(addr)})`);
    return `http://${addr}`;
}

/** Go が Redis に書く在席（`ubi:rooms` と `ubi:presence:<id>`）を読む。期限の切れた部屋は居ないものとして扱う。 */
export async function readRoomPresence(
    client: RedisCommands,
    prefix = DIRECTORY_PREFIX,
): Promise<Map<string, RoomPresence>> {
    const ids = (await client.sendCommand(['SMEMBERS', `${prefix}rooms`])) as string[];
    if (ids.length === 0) return new Map();
    const values = (await client.sendCommand(['MGET', ...ids.map((id) => `${prefix}presence:${id}`)])) as (
        | string
        | null
    )[];
    const expired = ids.filter((_, i) => !values[i]);
    if (expired.length > 0) {
        // 読んだあとに owner・在席が戻った部屋を一覧から消さないよう Redis 内で再確認する。
        const keys = [`${prefix}rooms`, ...expired.flatMap((id) => [`${prefix}presence:${id}`, `${prefix}room:${id}`])];
        await client.sendCommand(['EVAL', PRUNE_EXPIRED_ROOMS, String(keys.length), ...keys, ...expired]);
    }
    return new Map(
        ids.flatMap((id, i) => {
            const presence = parsePresence(id, values[i]);
            return presence ? [[id, presence] as const] : [];
        }),
    );
}

const PRUNE_EXPIRED_ROOMS = `for i, id in ipairs(ARGV) do
  if redis.call('EXISTS', KEYS[2*i]) == 0 and redis.call('EXISTS', KEYS[2*i+1]) == 0 then
    redis.call('SREM', KEYS[1], id)
  end
end
return 1`;

function parsePresence(id: string, value: string | null | undefined): RoomPresence | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as { members?: unknown; emptySince?: unknown; gen?: unknown; epoch?: unknown };
        if (!Array.isArray(parsed.members) || typeof parsed.emptySince !== 'number') return null;
        return {
            id,
            memberIds: parsed.members.filter((m): m is string => typeof m === 'string'),
            emptySince: parsed.emptySince,
            ...(typeof parsed.gen === 'string' &&
            parsed.gen &&
            typeof parsed.epoch === 'number' &&
            Number.isSafeInteger(parsed.epoch) &&
            parsed.epoch > 0
                ? { gen: parsed.gen, epoch: parsed.epoch }
                : {}),
        };
    } catch {
        return null;
    }
}

function generation(owner: Pick<RuntimeOwner, 'gen' | 'epoch'>): Record<string, string> {
    return owner.gen && owner.epoch ? { gen: owner.gen, epoch: String(owner.epoch) } : {};
}

/** 生きている owner の宛先。居ない・heartbeat が切れていれば null（少し待って入り直せば別の Pod が取る）。 */
function liveOwner(owner: RuntimeOwnerInfo | undefined): RuntimeOwner | null {
    if (!owner?.alive || !owner.addr) return null;
    return { base: ownerBase(owner.addr), gen: owner.gen, epoch: owner.epoch };
}

/** 409 の owner へ送り直す。owner が居なければ失敗にする（クライアントは少し待って入り直し、別の Pod が取る）。 */
function requireOwner(body: unknown): RuntimeOwner {
    const owner = liveOwner((body as RuntimeConflict).owner);
    if (!owner) throw new Error('Instance runtime: 部屋の owner が応答しません');
    return owner;
}

/** Go の管理API。SNSのDB・セッション情報はこの境界を越えない。 */
export function createInstanceRuntime(options: InstanceRuntimeOptions) {
    const send = options.fetch ?? fetch;
    const log = options.log ?? logger;

    function call(
        base: string,
        path: string,
        init: RequestInit = {},
        query: Record<string, string> = {},
    ): Promise<Response> {
        const search = new URLSearchParams(query).toString();
        return send(`${base}/realtime/v1${path}${search ? `?${search}` : ''}`, {
            ...init,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
            signal: AbortSignal.timeout(5000),
        });
    }

    async function request(
        base: string,
        path: string,
        init: RequestInit = {},
        query: Record<string, string> = {},
    ): Promise<Response> {
        const response = await call(base, path, init, query);
        if (!response.ok && response.status !== 409) throw new Error(`Instance runtime: ${response.status}`);
        return response;
    }

    /**
     * 部屋の作成を送る先。redis では Redis の各 Pod の状態から選ぶ（owner が生きていれば owner、居なければ空いている Pod）。
     * 選べない（Pod の状態が無い・Redis に届かない）ときと memory は Service に任せる。
     */
    async function placementTargets(id: string): Promise<string[]> {
        if (options.directory !== 'redis' || !options.redis) return [options.url];
        try {
            const view = await readPlacement(options.redis, id, DIRECTORY_PREFIX);
            const bases = placementOrder(view.nodes, view.owner).flatMap((node) => {
                try {
                    return [ownerBase(node.addr)];
                } catch {
                    return [];
                }
            });
            if (bases.length > 0) return bases.slice(0, PLACEMENT_ATTEMPTS);
        } catch (error) {
            log.warn(
                'Instance runtime: 置き場所を選べないので Service に任せます:',
                error instanceof Error ? error.message : error,
            );
        }
        return [options.url];
    }

    return {
        /** 在席。redis では各 Pod が書いた Redis の値（5 秒ごと・表示用の近似値）を読む。 */
        async presence(): Promise<Map<string, RoomPresence>> {
            if (options.directory === 'redis' && options.redis) return readRoomPresence(options.redis);
            const response = await request(options.url, '/instances');
            const data = (await response.json()) as { instances: RuntimePresence[] };
            return new Map(data.instances.map((instance) => [instance.id, instance]));
        },
        /** 部屋を割り当てて作り、続く管理 API の宛先（owner）を返す。別の Pod が持っていればその Pod を返す。 */
        async provision(id: string, maxUsers: number, world: ResolvedWorld): Promise<RuntimeOwner> {
            const body = JSON.stringify({
                id,
                name: world.displayName,
                maxUsers,
                snapshot: {
                    entities: world.initialEntities.flatMap((entity) => flattenGameObject(entity)),
                    availableComponents: [],
                    activeMods: world.dependencies?.map((dependency) => dependency.name) ?? [],
                    environment: world.environment,
                    lock: world.lock,
                    sourceKind: world.source.kind,
                },
            });
            const failures: string[] = [];
            for (const base of await placementTargets(id)) {
                // 503（draining・上限・Directory に届かない）と応答なしは、別の Pod へ送り直す。作成は冪等なので、
                // 応答だけが失われて部屋ができていても、次の Pod は 409 で owner を返す
                const response = await call(base, `/instances/${encodeURIComponent(id)}`, {
                    method: 'PUT',
                    body,
                }).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
                if (response instanceof Error || response.status === 503) {
                    failures.push(`${base}: ${response instanceof Error ? response.message : 503}`);
                    continue;
                }
                if (!response.ok && response.status !== 409) throw new Error(`Instance runtime: ${response.status}`);
                // 409 の owner が死んでいれば（割り当てを解放せずに落ちた）、リースの期限まではどの Pod も作れない。
                // 送り直さずに失敗にし、入室は 503 でクライアントに取り直させる
                if (response.status === 409) return requireOwner(await response.json());
                const presence = (await response.json()) as RuntimePresence;
                // memory は 1 Pod なので Service のまま。redis は Service が次に別の Pod へ当てるので owner へ直接送る
                const to = options.directory === 'redis' && presence.addr ? ownerBase(presence.addr) : options.url;
                return { base: to, gen: presence.gen, epoch: presence.epoch };
            }
            throw new Error(`Instance runtime: 部屋を置ける Pod がありません (${failures.join(', ')})`);
        },
        /** 部屋を閉じる。owner が別の Pod なら、その Pod へ世代を付けて送り直す。 */
        async close(
            id: string,
            emptyBefore?: number,
            observed?: Pick<RoomPresence, 'gen' | 'epoch'> | null,
        ): Promise<boolean> {
            const path = `/instances/${encodeURIComponent(id)}`;
            const query: Record<string, string> = emptyBefore === undefined ? {} : { emptyBefore: String(emptyBefore) };
            if (observed === null) query.absent = 'true';
            else if (observed !== undefined) {
                if (observed.gen && observed.epoch) Object.assign(query, generation(observed));
                else if (options.directory === 'redis') return false; // 旧 Pod の近似値には世代が無い。更新を待つ。
            }
            const response = await request(options.url, path, { method: 'DELETE' }, query);
            if (response.status !== 409) return response.status === 204;
            const conflict = (await response.json()) as RuntimeConflict;
            // reaper が見た世代・不在と違う部屋は閉じない。移動先が同じ世代なら宛先だけを変える。
            if (observed === null) return false;
            if (observed && (conflict.owner?.gen !== observed.gen || conflict.owner?.epoch !== observed.epoch))
                return false;
            // owner の無い 409 は owner の Pod 自身が答えた「在席がある・空いたばかり」
            const owner = liveOwner(conflict.owner);
            if (!owner) return false;
            const again = await request(owner.base, path, { method: 'DELETE' }, { ...query, ...generation(owner) });
            return again.status === 204;
        },
        /** owner の Pod でチケットを発行する。その間に owner が替わっていたら、新しい owner へ 1 回だけ送り直す。 */
        async ticket(id: string, userId: string, name: string | undefined, owner: RuntimeOwner): Promise<RuntimeGrant> {
            const issue = (to: RuntimeOwner) =>
                request(
                    to.base,
                    `/instances/${encodeURIComponent(id)}/tickets`,
                    { method: 'POST', body: JSON.stringify({ userId, ...(name ? { name } : {}) }) },
                    generation(to),
                );
            const first = await issue(owner);
            const response = first.status === 409 ? await issue(requireOwner(await first.json())) : first;
            if (response.status === 409) throw new Error('Instance runtime: 部屋の owner が替わりました');
            return { ...((await response.json()) as RuntimeGrant), url: options.publicUrl };
        },
    };
}

export type InstanceRuntime = ReturnType<typeof createInstanceRuntime>;

export const instanceRuntime: InstanceRuntime = createInstanceRuntime({
    url: appConfig.runtime.url,
    token: appConfig.runtime.token,
    publicUrl: appConfig.runtime.publicUrl,
    directory: appConfig.runtime.directory,
    redis,
});
