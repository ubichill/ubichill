import { createClient } from '@redis/client';
import { appConfig } from '../config';
import { logger } from '../utils/logger';

/** Redis への命令の最小の口。Lease・後のレート制限（rate-limit-redis の sendCommand）はこれだけに依存する。 */
export interface RedisCommands {
    sendCommand(args: ReadonlyArray<string>): Promise<unknown>;
}

// 切れている間の命令は待たせずに失敗させる。待たせると、リースの延長が復旧後に遅れて届き、期限の判断を誤る。
const newClient = (url: string, password: string | undefined) =>
    createClient({ url, password, disableOfflineQueue: true });

export type RedisConnection = ReturnType<typeof newClient>;

export type RedisHealth = 'ready' | 'unavailable';

interface RedisLog {
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
}

/** 切れた・戻ったの変化だけを記録し、接続を始める（Redis が落ちていても待たない）。 */
function watch(client: RedisConnection, label: string, log: RedisLog): RedisConnection {
    // 再接続のたびに error が出るので、切れた・戻ったの変化だけを記録する
    const state = { failing: false };
    client.on('error', (err: unknown) => {
        if (state.failing) return;
        state.failing = true;
        log.warn(`${label}に接続できません（再接続を続けます）:`, err instanceof Error ? err.message : err);
    });
    client.on('ready', () => {
        if (state.failing) log.info(`${label}に再接続しました`);
        state.failing = false;
    });
    client.connect().catch((err: unknown) => {
        log.warn(`${label}への接続を諦めました:`, err instanceof Error ? err.message : err);
    });
    return client;
}

/** 接続を始めて、すぐに返す（Redis が落ちていても backend の起動を止めない）。 */
export function connectRedis(options: { url: string; password?: string }, log: RedisLog = logger): RedisConnection {
    return watch(newClient(options.url, options.password), 'Redis ', log);
}

/**
 * Pub/Sub の購読用の別の接続（購読中の接続はほかの命令を送れない）。購読の要求は繋がるまで待たせ、
 * 再接続のあとは node-redis が購読し直す。
 */
export function connectSubscriber(client: RedisConnection, log: RedisLog = logger): RedisConnection {
    return watch(client.duplicate({ disableOfflineQueue: false }), 'Redis（購読）', log);
}

/** /health に載せる状態。Redis 未設定なら載せない。落ちていても backend 全体は healthy のまま（再起動しても直らないため）。 */
export function redisHealth(client: Pick<RedisConnection, 'isReady'> | null): RedisHealth | undefined {
    if (!client) return undefined;
    return client.isReady ? 'ready' : 'unavailable';
}

export const redis: RedisConnection | null = appConfig.redis.url
    ? connectRedis({ url: appConfig.redis.url, password: appConfig.redis.password })
    : null;
