// 1 回の iteration = 1 人の利用者。ログイン → 部屋を作る（1 人目）か探す → 参加情報 → WebSocket → 退室 → 片付け。
import { sleep } from 'k6';
import { scenario, test } from 'k6/execution';
import { type ApiTarget, createInstance, deleteInstance, discoverInstance, ensureSession, joinTicket } from './api.ts';
import type { LoadTestConfig } from './config.ts';
import { instanceOps, joinFailures, reconnects } from './metrics.ts';
import { loadtestAccount, planUser, roomsPerRunner, roomTag, runnerSlot, type UserPlan } from './plan.ts';
import { recoveryDelay, resolveSocketUrl } from './protocol.ts';
import { runSession } from './session.ts';

const DISCOVER_TIMEOUT_MS = 60_000;
const DISCOVER_INTERVAL_SECONDS = 1;
// 作った人は、ほかの人が退室し終わるのを待ってから消す（先に消すと残りの人が切断に数えられる）
const DELETE_AFTER_LEAVE_SECONDS = 3;
const RECONNECT_DELAY_MS = 1_000;

interface RoomContext {
    readonly config: LoadTestConfig;
    readonly target: ApiTarget;
    readonly plan: UserPlan;
    readonly cookie: string;
    readonly instanceId: string;
    readonly displayName: string;
    readonly deadlineMs: number;
    readonly startedAtMs: number;
}

const segmentOptions = (): { segment?: string; sequence?: string } => {
    const options: unknown = test.options;
    const record = typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {};
    return {
        segment: typeof record.executionSegment === 'string' ? record.executionSegment : undefined,
        sequence: typeof record.executionSegmentSequence === 'string' ? record.executionSegmentSequence : undefined,
    };
};

/** 部屋が runner に均等に分けられないと、同じ部屋の人が別の Pod に分かれる。setup で止める。 */
export function runnerSplitProblem(config: LoadTestConfig): string | null {
    const { segment, sequence } = segmentOptions();
    const slot = runnerSlot(segment, sequence);
    return roomsPerRunner(config.rooms, slot) === null
        ? `部屋の数（${config.rooms}）が runner の数（parallelism = ${slot.count}）で割り切れません`
        : null;
}

export async function runUser(config: LoadTestConfig): Promise<void> {
    const { segment, sequence } = segmentOptions();
    const plan = planUser(config, runnerSlot(segment, sequence), scenario.iterationInInstance);
    if (plan === null) return;
    const startedAtMs = Date.now();
    const deadlineMs = scenario.startTime + (config.rampSeconds + config.holdSeconds) * 1000;
    const target: ApiTarget = { origin: config.origin, apiBase: config.apiBase };
    const account = loadtestAccount('user', config.accountOffset + plan.userIndex, config.accountPassword);

    const session = ensureSession(target, account);
    if (!session.ok) {
        joinFailures.add(1, { stage: 'account', reason: session.reason });
        return;
    }
    const tag = roomTag(config.testId, plan.room);
    const instanceId = plan.creator
        ? createRoom(config, target, session.cookie, tag)
        : discoverInstance(target, session.cookie, {
              worldId: config.worldId,
              tag,
              deadlineMs: Math.min(deadlineMs, startedAtMs + DISCOVER_TIMEOUT_MS),
              intervalSeconds: DISCOVER_INTERVAL_SECONDS,
          });
    if (instanceId === null) {
        if (!plan.creator) joinFailures.add(1, { stage: 'discover', reason: 'not_found' });
        return;
    }
    const room: RoomContext = {
        config,
        target,
        plan,
        cookie: session.cookie,
        instanceId,
        displayName: account.displayName,
        deadlineMs,
        startedAtMs,
    };
    await joinRoom(room, { attempt: 0, sinceMs: Date.now() });
    if (plan.creator) {
        // 自分が早く抜けても（入室の失敗など）、ほかの人の退室の時刻までは消さない
        sleep(Math.max(0, deadlineMs - Date.now()) / 1000 + DELETE_AFTER_LEAVE_SECONDS);
        instanceOps.add(1, { op: 'delete', result: deleteInstance(target, session.cookie, instanceId) });
    }
}

function createRoom(config: LoadTestConfig, target: ApiTarget, cookie: string, tag: string): string | null {
    const created = createInstance(target, cookie, {
        worldId: config.worldId,
        tag,
        maxUsers: config.maxUsersPerRoom,
    });
    if ('id' in created) {
        instanceOps.add(1, { op: 'create', result: 'ok' });
        return created.id;
    }
    instanceOps.add(1, { op: 'create', result: created.error });
    joinFailures.add(1, {
        stage: 'create',
        reason: created.error === 'rate_limited' ? 'rate_limited' : `status_${created.status}`,
    });
    return null;
}

interface Recovery {
    readonly attempt: number;
    /** 入室・繋ぎ直しを始めた時刻。一時的な失敗はここから RECOVERY_MS まで取り直す */
    readonly sinceMs: number;
}

/**
 * 参加情報を取って入る。一時的な失敗（Pod の再起動・部屋の作り直しの間の 503・部屋が無い・世代のずれ）は、
 * Host と同じく期限まで取り直して入り直す。途中で切られたら繋ぎ直す。
 */
async function joinRoom(room: RoomContext, recovery: Recovery): Promise<void> {
    const retry = async (stage: 'ticket' | 'join', reason: string): Promise<void> => {
        joinFailures.add(1, { stage, reason });
        const delay = recoveryDelay(stage, reason, recovery.attempt, Date.now() - recovery.sinceMs);
        if (delay === null || Date.now() + delay >= room.deadlineMs) return;
        sleep(delay / 1000);
        await joinRoom(room, { attempt: recovery.attempt + 1, sinceMs: recovery.sinceMs });
    };
    const ticket = joinTicket(room.target, room.cookie, room.instanceId);
    if ('error' in ticket) {
        await retry('ticket', ticket.error);
        return;
    }
    const outcome = await runSession({
        url: resolveSocketUrl(ticket.url, room.config.origin, room.config.wsBase),
        origin: room.config.origin,
        instanceId: room.instanceId,
        token: ticket.token,
        displayName: room.displayName,
        plan: room.plan,
        cursorHz: room.config.cursorHz,
        patchIntervalSeconds: room.config.patchIntervalSeconds,
        cursorBatch: room.config.cursorBatch,
        stateKey: 'loadtest',
        deadlineMs: room.deadlineMs,
        startedAtMs: room.startedAtMs,
    });
    if (outcome.kind === 'done') return;
    if (outcome.kind === 'dropped') {
        if (Date.now() + RECONNECT_DELAY_MS >= room.deadlineMs) return;
        reconnects.add(1, { code: String(outcome.code) });
        sleep(RECONNECT_DELAY_MS / 1000);
        const now = Date.now();
        await joinRoom({ ...room, startedAtMs: now }, { attempt: 0, sinceMs: now });
        return;
    }
    await retry('join', outcome.kind === 'connect_failed' ? 'connect_failed' : outcome.failure);
}
