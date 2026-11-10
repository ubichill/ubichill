/**
 * activity を相手の inbox へ送る。送る予定は DB に置き（backend が落ちても失われない）、配送役が取り出して送る。
 * 送り直し・諦める・相手のサーバーを止める規則は shared の delivery.ts。
 */
import type { DeliveryRecord, NewDelivery } from '@ubichill/db';
import {
    ACTIVITY_CONTENT_TYPE,
    classifyDelivery,
    DELIVERY_LIMITS,
    type DomainPolicy,
    deliveryDeadline,
    exchanges,
    hostOf,
    retryDelayMs,
    SIGNATURE_TIMING,
} from '@ubichill/shared';
import { nanoid } from 'nanoid';
import type { FederationIdentity } from '../identity';
import type { ServerDirectory } from './servers';
import type { SignAs, Transport } from './transport';

export interface OutboxDeps {
    identity: FederationIdentity;
    repo: {
        enqueue(input: NewDelivery, now: Date): Promise<void>;
    };
    policyOf(domain: string): DomainPolicy;
    now(): number;
}

export interface OutboxMessage {
    activity: Record<string, unknown> & { id: string };
    from: SignAs;
    to: { id: string; inbox: string };
    endTime?: Date;
}

export interface Outbox {
    /** activity を相手へ送る予定に入れる（from の鍵で署名する）。期限のある activity は期限で諦める */
    send(message: OutboxMessage): Promise<void>;
    /** 送る予定の行を作るだけ（入れるのは呼ぶ側。状態の書き込みと同じトランザクションに入れるとき）。送らない相手なら null */
    prepare(message: OutboxMessage): NewDelivery | null;
}

export function createOutbox(deps: OutboxDeps): Outbox {
    const prepare = ({ activity, from, to, endTime }: OutboxMessage): NewDelivery | null => {
        const host = hostOf(to.inbox);
        if (!host || !exchanges(deps.policyOf(host))) return null;
        const sender = from.kind === 'app' ? deps.identity.appActorUrl : deps.identity.actorUrl(from.userId);
        return {
            id: nanoid(),
            senderUserId: from.kind === 'user' ? from.userId : null,
            inbox: to.inbox,
            host,
            body: activity,
            // 同じ 2 人の間は、出した順に届ける（申請 → 取り消しが逆に届かないように）
            orderKey: `${sender}|${to.id}`,
            deadlineAt: new Date(deliveryDeadline(deps.now(), endTime?.getTime())),
        };
    };
    return {
        prepare,
        async send(message) {
            const delivery = prepare(message);
            if (delivery) await deps.repo.enqueue(delivery, new Date(deps.now()));
        },
    };
}

export interface DeliveryWorkerDeps {
    repo: {
        claimDue(input: {
            now: Date;
            limit: number;
            lockMs: number;
            excludedHosts: readonly string[];
        }): Promise<DeliveryRecord[]>;
        remove(id: string): Promise<void>;
        reschedule(id: string, nextAttemptAt: Date, error: string): Promise<void>;
        deleteExpired(now: Date): Promise<number>;
    };
    transport: Pick<Transport, 'post'>;
    servers: Pick<ServerDirectory, 'pausedHosts' | 'recordSuccess' | 'recordFailure'>;
    now(): number;
    random?: () => number;
    log?: (message: string) => void;
    /** 届けられずに諦めた（断られた・期限を過ぎた）。関係の確かめ直しを早めるのに使う */
    gaveUp?: (delivery: DeliveryRecord) => Promise<void>;
}

/** 1 つの予定を送り、結果で消す・送り直す。 */
async function deliverOne(deps: DeliveryWorkerDeps, delivery: DeliveryRecord): Promise<void> {
    const signAs: SignAs = delivery.senderUserId ? { kind: 'user', userId: delivery.senderUserId } : { kind: 'app' };
    const response = await deps.transport
        .post(delivery.inbox, delivery.body, {
            signAs,
            ttlSec: SIGNATURE_TIMING.INBOX_TTL_SEC,
            contentType: ACTIVITY_CONTENT_TYPE,
            // Mastodon・Misskey などへは RSA の draft-cavage で（相手が RFC 9421 の Ed25519 を告知していなければ）
            scheme: 'auto',
        })
        .catch((error: unknown) => ({ status: null as number | null, retryAfter: null, error }));
    const status = response.status;
    const outcome = classifyDelivery(status, response.retryAfter, deps.now());
    if (outcome.kind !== 'retry') {
        await deps.repo.remove(delivery.id);
        // 応答があった（受けない・もういない、も含めて）ので、相手のサーバーは動いている
        await deps.servers.recordSuccess(delivery.host);
        if (outcome.kind === 'rejected') {
            deps.log?.(`配送を断られました (${status}): ${delivery.inbox}`);
            await deps.gaveUp?.(delivery);
        }
        return;
    }
    await deps.servers.recordFailure(delivery.host);
    const attempts = delivery.attempts + 1;
    const delay = outcome.retryAfterMs ?? retryDelayMs(attempts, (deps.random ?? Math.random)());
    const next = deps.now() + delay;
    if (next > delivery.deadlineAt.getTime()) {
        await deps.repo.remove(delivery.id);
        deps.log?.(`配送を諦めました（${attempts} 回）: ${delivery.inbox}`);
        await deps.gaveUp?.(delivery);
        return;
    }
    await deps.repo.reschedule(delivery.id, new Date(next), status === null ? 'network' : `HTTP ${status}`);
}

/** 届ける役。定期的に予定を取り出して送る（何台で動かしても、同じ予定を 2 度送らない）。 */
export function createDeliveryWorker(deps: DeliveryWorkerDeps & { intervalMs?: number; batch?: number }) {
    const state = { timer: null as ReturnType<typeof setInterval> | null, running: false, lastSweep: 0 };

    const runOnce = async (): Promise<number> => {
        const now = deps.now();
        if (now - state.lastSweep > 10 * 60 * 1000) {
            state.lastSweep = now;
            await deps.repo.deleteExpired(new Date(now));
        }
        const claimed = await deps.repo.claimDue({
            now: new Date(now),
            limit: deps.batch ?? 20,
            lockMs: 60_000,
            excludedHosts: await deps.servers.pausedHosts(),
        });
        const byHost = Map.groupBy(claimed, (d) => d.host);
        await Promise.all(
            [...byHost.values()].map(async (deliveries) => {
                // 1 つのホストへは同時に PER_HOST_CONCURRENCY まで
                const size = DELIVERY_LIMITS.PER_HOST_CONCURRENCY;
                const chunks = Array.from({ length: Math.ceil(deliveries.length / size) }, (_, i) =>
                    deliveries.slice(i * size, i * size + size),
                );
                for (const chunk of chunks) await Promise.all(chunk.map((d) => deliverOne(deps, d)));
            }),
        );
        return claimed.length;
    };

    return {
        runOnce,
        start() {
            if (state.timer) return;
            state.timer = setInterval(() => {
                if (state.running) return;
                state.running = true;
                runOnce()
                    .catch((error: unknown) => deps.log?.(`配送でエラー: ${String(error)}`))
                    .finally(() => {
                        state.running = false;
                    });
            }, deps.intervalMs ?? 2000);
            state.timer.unref?.();
        },
        stop() {
            if (state.timer) clearInterval(state.timer);
            state.timer = null;
        },
    };
}

export type DeliveryWorker = ReturnType<typeof createDeliveryWorker>;
