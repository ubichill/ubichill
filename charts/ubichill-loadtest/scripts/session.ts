// 1 人の利用者の WebSocket（入室 → 操作 → 退室）。Host（packages/frontend）と同じフレームを同じ順で送る。
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'k6/timers';
import { WebSocket } from 'k6/websockets';
import { cursorLatency, disconnects, joinDuration, joined, left, notices, readyDuration, requests } from './metrics.ts';
import type { UserPlan } from './plan.ts';
import {
    closedBy,
    createdEntityId,
    cursorPosition,
    cursorStamps,
    encodeFrame,
    isRecord,
    type JoinFailure,
    joinFailure,
    latencyMs,
    migratingRetryDelay,
    nextRevision,
    noticeKind,
    parseFrame,
    requestResult,
} from './protocol.ts';

const REQUEST_TIMEOUT_MS = 5_000;
const JOIN_TIMEOUT_MS = 10_000;
const LEAVE_TIMEOUT_MS = 3_000;
const JOIN_REQUEST_ID = 'join';

export interface SessionInput {
    readonly url: string;
    readonly origin: string;
    readonly instanceId: string;
    readonly token: string;
    readonly displayName: string;
    readonly plan: UserPlan;
    readonly cursorHz: number;
    readonly patchIntervalSeconds: number;
    readonly cursorBatch: boolean;
    /** 部屋の共有状態のキー（同じ部屋の書き手が同じキーを書き合う） */
    readonly stateKey: string;
    /** この時刻（epoch ms）に退室する */
    readonly deadlineMs: number;
    /** 利用者が始めた時刻（ログインの前）。world:snapshot までの時間に使う */
    readonly startedAtMs: number;
}

export type SessionOutcome =
    | { readonly kind: 'done' }
    | { readonly kind: 'connect_failed' }
    /** 退室の前にサーバーから切られた（Host なら繋ぎ直す） */
    | { readonly kind: 'dropped'; readonly code: number }
    | { readonly kind: 'join_failed'; readonly failure: JoinFailure };

interface Pending {
    readonly resolve: (reply: unknown) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

export function runSession(input: SessionInput): Promise<SessionOutcome> {
    return new Promise((resolve) => {
        const ws = new WebSocket(input.url, null, {
            // ブラウザと同じ Origin。Go は Host と違う Origin を許可リストで確かめる
            headers: { Origin: input.origin },
            tags: { name: 'WS /realtime/v1/ws' },
        });
        const openedAt = Date.now();
        const state = {
            opened: false,
            joined: false,
            closing: false,
            finished: false,
            outcome: { kind: 'done' } as SessionOutcome,
            seq: 0,
            revision: 0,
            patches: 0,
            writes: 0,
        };
        const pending = new Map<string, Pending>();
        const intervals: ReturnType<typeof setInterval>[] = [];
        const timeouts: ReturnType<typeof setTimeout>[] = [];

        const later = (ms: number, fn: () => void): void => {
            timeouts.push(setTimeout(fn, ms));
        };
        const wait = (ms: number): Promise<void> => new Promise((done) => later(ms, done));
        const every = (ms: number, fn: () => void): void => {
            intervals.push(
                setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN && !state.closing) fn();
                }, ms),
            );
        };
        const send = (event: string, data: unknown, id?: string): boolean => {
            if (ws.readyState !== WebSocket.OPEN) return false;
            ws.send(encodeFrame(event, data, id));
            return true;
        };
        const ask = (event: string, data: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> =>
            new Promise((done) => {
                state.seq += 1;
                const id = `r${state.seq}`;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    done(undefined);
                }, timeoutMs);
                pending.set(id, { resolve: done, timer });
                if (!send(event, data, id)) {
                    clearTimeout(timer);
                    pending.delete(id);
                    done({ success: false, error: 'closed' });
                }
            });
        const tracked = async (event: string, data: unknown, attempt = 0): Promise<unknown> => {
            const reply = await ask(event, data);
            // 接続を閉じたときに打ち切った要求は、期限切れに数えない
            if (state.finished) return reply;
            const result = requestResult(reply);
            requests.add(1, { event, result });
            const delay = migratingRetryDelay(result, attempt);
            if (delay === null || state.closing) return reply;
            await wait(delay);
            return tracked(event, data, attempt + 1);
        };

        const finish = (): void => {
            if (state.finished) return;
            state.finished = true;
            for (const id of intervals) clearInterval(id);
            for (const id of timeouts) clearTimeout(id);
            for (const entry of pending.values()) {
                clearTimeout(entry.timer);
                entry.resolve(undefined);
            }
            pending.clear();
            resolve(state.opened ? state.outcome : { kind: 'connect_failed' });
        };
        const closeByClient = (outcome?: SessionOutcome): void => {
            if (outcome) state.outcome = outcome;
            state.closing = true;
            for (const id of intervals) clearInterval(id);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        };

        const startPatching = async (): Promise<void> => {
            const entityId = createdEntityId(
                await tracked('entity:create', {
                    type: 'loadtest:box',
                    transform: { x: 0, y: 0, z: 0, w: 10, h: 10, scale: 1, rotation: 0 },
                    data: { n: 0 },
                }),
            );
            if (entityId === null) return;
            every(input.patchIntervalSeconds * 1000, () => {
                state.patches += 1;
                void tracked('entity:patch', { entityId, patch: { data: { n: state.patches } } });
            });
        };
        const writeState = async (): Promise<void> => {
            state.writes += 1;
            const reply = await tracked('state:update', {
                key: input.stateKey,
                value: { by: input.plan.indexInRoom, n: state.writes },
                expectedRevision: state.revision,
            });
            state.revision = nextRevision(state.revision, reply);
        };
        const leave = async (): Promise<void> => {
            if (state.closing) return;
            state.closing = true;
            for (const id of intervals) clearInterval(id);
            // Go は応答を送ってから接続を閉じる。応答が来なくても閉じる
            await ask('world:leave', null, LEAVE_TIMEOUT_MS);
            closeByClient();
        };

        const onJoined = (): void => {
            const now = Date.now();
            state.joined = true;
            joinDuration.add(now - openedAt);
            readyDuration.add(now - input.startedAtMs);
            joined.add(1);
            if (input.plan.active && input.cursorHz > 0) {
                every(1000 / input.cursorHz, () =>
                    send('cursor:move', { position: cursorPosition(input.plan.creator, Date.now(), Math.random) }),
                );
            }
            if (input.patchIntervalSeconds > 0) {
                if (input.plan.creator) void startPatching();
                if (input.plan.stateWriter) every(input.patchIntervalSeconds * 1000, () => void writeState());
            }
            later(Math.max(0, input.deadlineMs - now), () => void leave());
        };

        ws.onopen = () => {
            state.opened = true;
            send(
                'world:join',
                {
                    instanceId: input.instanceId,
                    token: input.token,
                    user: { name: input.displayName, status: 'online', position: { x: 0, y: 0 } },
                    ...(input.cursorBatch ? { features: ['cursors:batch'] } : {}),
                },
                JOIN_REQUEST_ID,
            );
            later(JOIN_TIMEOUT_MS, () => {
                if (!state.joined) closeByClient({ kind: 'join_failed', failure: 'timeout' });
            });
        };

        ws.onmessage = (message) => {
            const frame = parseFrame(message?.data);
            if (frame === null) return;
            if (frame.replyTo !== undefined) {
                if (frame.replyTo === JOIN_REQUEST_ID) {
                    if (!isRecord(frame.data) || frame.data.success !== true) {
                        closeByClient({ kind: 'join_failed', failure: joinFailure(frame.data) });
                    }
                    return;
                }
                const entry = pending.get(frame.replyTo);
                pending.delete(frame.replyTo);
                if (entry) {
                    clearTimeout(entry.timer);
                    entry.resolve(frame.data);
                }
                return;
            }
            const event = frame.event ?? '';
            if (event === 'world:snapshot') {
                if (!state.joined) onJoined();
                return;
            }
            if (input.plan.latencyReceiver) {
                const now = Date.now();
                for (const stamp of cursorStamps(event, frame.data)) cursorLatency.add(latencyMs(stamp, now));
            }
            if (event === 'state:changed' && isRecord(frame.data) && frame.data.key === input.stateKey) {
                state.revision = nextRevision(state.revision, frame.data);
            }
            const kind = noticeKind(event, frame.data);
            if (kind !== null) notices.add(1, { kind });
        };

        // 型は引数なしだが、実際は close code を持つイベントが渡る
        ws.onclose = (event?: unknown) => {
            const code = isRecord(event) && typeof event.code === 'number' ? event.code : 0;
            if (state.opened) disconnects.add(1, { code: String(code), by: closedBy(state.closing) });
            if (state.joined) left.add(1);
            if (state.opened && !state.closing) state.outcome = { kind: 'dropped', code };
            finish();
        };
        // 繋がらなかったときは close が来ないことがある
        ws.onerror = () => {
            if (!state.opened) finish();
        };
    });
}
