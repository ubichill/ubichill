import type { InstanceAPI, ResolvedWorld } from '@ubichill/shared';
import { appConfig } from '../config';
import { type RedisCommands, redis } from '../lib/redis';
import { flattenGameObject } from './flattenGameObject';

export type RuntimePresence = InstanceAPI['schemas']['RuntimePresence'];
export type RuntimeGrant = InstanceAPI['schemas']['InstanceGrant'];
type RuntimeConflict = InstanceAPI['schemas']['Conflict'];
type RuntimeOwnerInfo = InstanceAPI['schemas']['InstanceOwner'];

/** 一覧・入室の判定・reaper が使う在席。Redis から読むときは名前・定員が無い。 */
export type RoomPresence = Pick<RuntimePresence, 'id' | 'memberIds' | 'emptySince'>;

/** 部屋の owner の管理 API の宛先と、呼び出しに付ける世代（Go は世代が合わなければ 409 を返す）。 */
export interface RuntimeOwner {
    base: string;
    gen?: string;
    epoch?: number;
}

export type DirectoryMode = 'memory' | 'redis';

export interface InstanceRuntimeOptions {
    /** INSTANCE_RUNTIME_URL（Service）。memory では全部ここへ送る。redis では最初の割り当てだけ */
    url: string;
    token: string;
    publicUrl: string;
    directory: DirectoryMode;
    redis: RedisCommands | null;
    fetch?: typeof fetch;
}

/** Go の Directory のキーの名前空間（services/instance/internal/coord の DirectoryFor と同じ）。 */
const DIRECTORY_PREFIX = 'ubi:';

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
    return new Map(
        ids.flatMap((id, i) => {
            const presence = parsePresence(id, values[i]);
            return presence ? [[id, presence] as const] : [];
        }),
    );
}

function parsePresence(id: string, value: string | null | undefined): RoomPresence | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as { members?: unknown; emptySince?: unknown };
        if (!Array.isArray(parsed.members) || typeof parsed.emptySince !== 'number') return null;
        return {
            id,
            memberIds: parsed.members.filter((m): m is string => typeof m === 'string'),
            emptySince: parsed.emptySince,
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

    async function request(
        base: string,
        path: string,
        init: RequestInit = {},
        query: Record<string, string> = {},
    ): Promise<Response> {
        const search = new URLSearchParams(query).toString();
        const response = await send(`${base}/realtime/v1${path}${search ? `?${search}` : ''}`, {
            ...init,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok && response.status !== 409) throw new Error(`Instance runtime: ${response.status}`);
        return response;
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
            const response = await request(options.url, `/instances/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify({
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
                }),
            });
            if (response.status === 409) return requireOwner(await response.json());
            const presence = (await response.json()) as RuntimePresence;
            // memory は 1 Pod なので Service のまま。redis は Service が次に別の Pod へ当てるので owner へ直接送る
            const base = options.directory === 'redis' && presence.addr ? ownerBase(presence.addr) : options.url;
            return { base, gen: presence.gen, epoch: presence.epoch };
        },
        /** 部屋を閉じる。owner が別の Pod なら、その Pod へ世代を付けて送り直す。 */
        async close(id: string, emptyBefore?: number): Promise<boolean> {
            const path = `/instances/${encodeURIComponent(id)}`;
            const query: Record<string, string> = emptyBefore === undefined ? {} : { emptyBefore: String(emptyBefore) };
            const response = await request(options.url, path, { method: 'DELETE' }, query);
            if (response.status !== 409) return response.status === 204;
            const conflict = (await response.json()) as RuntimeConflict;
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
