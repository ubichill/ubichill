// @vitest-environment jsdom
import type {
    MediaState,
    ModHostEvent,
    SharedStateEntry,
    SharedStateResult,
    SharedStateUpdate,
} from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMediaRuntime, type MediaRuntime, type MediaSocket } from './createMediaRuntime';
import { mediaStateKey } from './mediaTimeline';

const DEFINITION = 'test-media:screen';
const SCOPE = 'world-1';
const KEY = mediaStateKey(`${DEFINITION}:${SCOPE}:main`);
const T0 = 1_700_000_000_000;
/** ローカルの時計（Date.now）。サーバーの時計はこれより SKEW だけ進んでいる。 */
const clock = { local: 1_000 };
const SKEW = T0 - 1_000;

/** Go の共有状態と同じ規則（revision の比較と交換・書いた本人以外への配信）だけを持つ部屋。 */
class FakeRoom {
    readonly state = new Map<string, SharedStateEntry>();
    readonly writes: SharedStateUpdate[] = [];
    readonly members: Array<{ userId: string; runtime: MediaRuntime; muted: boolean }> = [];
    get now(): number {
        return clock.local + SKEW;
    }

    socketFor(userId: string): MediaSocket {
        const reply = (callback: unknown, result: SharedStateResult) =>
            queueMicrotask(() => (callback as (r: SharedStateResult) => void)(result));
        return {
            connected: true,
            emit: (event, data, callback) => {
                if (event === 'state:get') {
                    const { key } = data as { key: string };
                    reply(callback, { success: true, entry: this.state.get(key) ?? null, serverTime: this.now });
                    return;
                }
                const update = data as SharedStateUpdate;
                const current = this.state.get(update.key) ?? null;
                if ((current?.revision ?? 0) !== update.expectedRevision) {
                    reply(callback, {
                        success: false,
                        error: 'conflict',
                        code: 'conflict',
                        entry: current,
                        serverTime: this.now,
                    });
                    return;
                }
                this.writes.push(update);
                const entry: SharedStateEntry = {
                    key: update.key,
                    value: structuredClone(update.value),
                    revision: (current?.revision ?? 0) + 1,
                    updatedAt: this.now,
                    updatedBy: userId,
                };
                this.state.set(update.key, entry);
                reply(callback, { success: true, entry, serverTime: this.now });
                this.broadcast(entry, userId);
            },
        };
    }

    broadcast(entry: SharedStateEntry, except?: string): void {
        for (const member of this.members) {
            if (member.userId !== except && !member.muted)
                queueMicrotask(() => member.runtime.acceptSharedState(entry));
        }
    }
}

function join(room: FakeRoom, userId: string) {
    const events: ModHostEvent[] = [];
    const socket = room.socketFor(userId);
    const runtime = createMediaRuntime({
        definitionId: DEFINITION,
        syncScopeId: SCOPE,
        modId: 'test-media',
        permissionSubject: 'test-media',
        mediaVisibility: new Map(),
        getSocket: () => socket,
        authorizeUrl: async (url) => ({ allowed: true, url }),
        sendEvent: (event) => events.push(event),
    });
    const member = { userId, runtime, muted: false };
    room.members.push(member);
    runtime.getVideoRef('main')(document.createElement('video'));
    const state = (): MediaState => {
        const last = events.filter((event) => event.type === 'EVT_MEDIA_STATE').at(-1);
        if (!last) throw new Error('no state');
        return last.payload as MediaState;
    };
    return { runtime, member, state };
}

const settle = async (): Promise<void> => {
    for (const _ of Array.from({ length: 20 })) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function loadShared(runtime: MediaRuntime): Promise<void> {
    await runtime.mediaHandlers.onMediaLoad?.('main', 'https://media.example/one.mp4', 'video', 'video', {
        source: { url: 'https://media.example/one.mp4', type: 'file', id: 'one' },
        sync: 'shared',
        loadId: 'load-1',
    });
    await settle();
}

beforeEach(() => {
    clock.local = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock.local);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('createMediaRuntime: 共有状態でのタイムライン', () => {
    it('後から同じメディアを読み込んだ人は書かずに今のタイムラインに合わせる', async () => {
        const room = new FakeRoom();
        const alice = join(room, 'alice');
        const bob = join(room, 'bob');
        await loadShared(alice.runtime);
        clock.local += 1_000;
        await loadShared(bob.runtime);

        expect(room.writes).toHaveLength(1);
        expect(bob.state().timeline).toMatchObject({ mediaId: 'one', phase: 'paused', revision: 1 });

        alice.runtime.mediaHandlers.onMediaPlay?.('main');
        await settle();
        expect(room.state.get(KEY)).toMatchObject({ revision: 2, updatedBy: 'alice' });
        expect(bob.state().timeline).toMatchObject({ phase: 'playing', revision: 2, anchorServerTime: T0 + 1_000 });
    });

    it('他の人が先に更新していたら書かずに最新の状態に合わせ直す', async () => {
        const room = new FakeRoom();
        const alice = join(room, 'alice');
        const bob = join(room, 'bob');
        await loadShared(alice.runtime);
        await loadShared(bob.runtime);
        alice.runtime.mediaHandlers.onMediaPlay?.('main');
        await settle();

        // bob には pause の通知が届かず、古い revision のまま seek する
        bob.member.muted = true;
        clock.local += 4_000;
        alice.runtime.mediaHandlers.onMediaPause?.('main');
        await settle();
        bob.runtime.mediaHandlers.onMediaSeek?.('main', 30);
        await settle();

        const stored = room.state.get(KEY);
        expect(stored).toMatchObject({ revision: 3, updatedBy: 'alice', value: { phase: 'paused', anchorTime: 4 } });
        expect(bob.state().timeline).toMatchObject({ revision: 3, phase: 'paused', anchorTime: 4 });
    });

    it('古い revision の通知は無視するが、部屋が作り直されたあとの取得結果には従う', async () => {
        const room = new FakeRoom();
        const alice = join(room, 'alice');
        await loadShared(alice.runtime);
        alice.runtime.mediaHandlers.onMediaPlay?.('main');
        await settle();
        const playing = room.state.get(KEY);
        if (!playing) throw new Error('not stored');

        alice.runtime.acceptSharedState({
            ...playing,
            revision: 1,
            value: { ...(playing.value as object), phase: 'paused' },
        });
        expect(alice.state().timeline).toMatchObject({ revision: 2, phase: 'playing' });

        // owner の交代などで共有状態が消え、revision が 1 からやり直しになる
        room.state.clear();
        alice.runtime.refreshTimelines();
        await settle();
        const restarted: SharedStateEntry = {
            ...playing,
            revision: 1,
            updatedBy: 'carol',
            value: { ...(playing.value as object), anchorTime: 7 },
        };
        room.state.set(KEY, restarted);
        room.broadcast(restarted);
        await settle();
        expect(alice.state().timeline).toMatchObject({ revision: 1, anchorTime: 7, updatedBy: 'carol' });
    });

    it('壊れた値や別のキーの通知ではタイムラインを変えない', async () => {
        const room = new FakeRoom();
        const alice = join(room, 'alice');
        await loadShared(alice.runtime);
        const before = alice.state().timeline;
        alice.runtime.acceptSharedState({
            key: KEY,
            value: { phase: 'playing' },
            revision: 9,
            updatedAt: T0,
            updatedBy: 'eve',
        });
        alice.runtime.acceptSharedState({
            key: mediaStateKey('other:scope:main'),
            value: { mediaId: 'one', phase: 'playing', anchorTime: 0, playbackRate: 1, duration: null },
            revision: 10,
            updatedAt: T0,
            updatedBy: 'eve',
        });
        expect(alice.state().timeline).toEqual(before);
    });
});
