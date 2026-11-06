import { type AppNotification, encodeFeedCursor, feedPositionOf } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    EMPTY_FEED,
    type FeedState,
    markReadLocally,
    undoMarkRead,
    withFirstPage,
    withNextPage,
    withStreamEvent,
} from './notificationFeed';

const actor = { type: 'Person', id: 'alice', name: 'Alice', preferredUsername: 'alice', icon: null } as const;
const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const follow = (id: string, day: number, read = false): AppNotification => ({
    id,
    type: 'Follow',
    actor,
    object: { type: 'Person', id: 'bob' },
    published: at(day),
    read,
});
const announce = (id: string, day: number, read = false): AppNotification => ({
    id,
    type: 'Announce',
    actor,
    object: { type: 'Note', id, summary: id, content: 'c' },
    published: at(day),
    read,
});
const cursorAfter = (n: AppNotification) => encodeFeedCursor(feedPositionOf(n));
const ids = (s: FeedState) => s.items.map((n) => n.id);

describe('一覧の取得', () => {
    it('続きのページを古い順の後ろに足し、重なった通知は二重にしない', () => {
        const first = withFirstPage(EMPTY_FEED, {
            items: [follow('n5', 5), follow('n4', 4)],
            nextCursor: cursorAfter(follow('n4', 4)),
            unreadCount: 4,
        });
        // 取得の間に新しい通知が届き、続きのページの先頭が n4 と重なった
        const next = withNextPage(first, {
            items: [follow('n4', 4, true), follow('n3', 3)],
            nextCursor: null,
            unreadCount: 3,
        });
        expect(ids(next)).toEqual(['n5', 'n4', 'n3']);
        expect(next.items[1]?.read).toBe(true);
        expect(next.nextCursor).toBeNull();
    });

    it('最初のページを取り直すと、範囲の中で消えた通知は落ち、古く読み込んであった分と続きのカーソルは残る', () => {
        const loaded: FeedState = {
            items: [follow('n5', 5), follow('n4', 4), follow('n2', 2), follow('n1', 1)],
            nextCursor: 'older-cursor',
            unreadCount: 4,
            loaded: true,
        };
        // n4 は取り消された。n6 が新しく来た
        const refreshed = withFirstPage(loaded, {
            items: [follow('n6', 6), follow('n5', 5, true), follow('n3', 3)],
            nextCursor: cursorAfter(follow('n3', 3)),
            unreadCount: 2,
        });
        expect(ids(refreshed)).toEqual(['n6', 'n5', 'n3', 'n2', 'n1']);
        expect(refreshed.nextCursor).toBe('older-cursor');
        expect(refreshed.unreadCount).toBe(2);
    });

    it('取り直したページで最後まで分かれば、手元の古い分は全部置き換える', () => {
        const loaded: FeedState = { items: [follow('gone', 1)], nextCursor: null, unreadCount: 1, loaded: true };
        const refreshed = withFirstPage(loaded, { items: [], nextCursor: null, unreadCount: 0 });
        expect(refreshed.items).toEqual([]);
        expect(refreshed.loaded).toBe(true);
    });
});

describe('SSE の差分', () => {
    const base: FeedState = { items: [follow('n2', 2)], nextCursor: null, unreadCount: 7, loaded: true };

    it('新しい通知は順番どおりに入り、未読が増える', () => {
        const next = withStreamEvent(base, { type: 'notification', notification: follow('n3', 3) });
        expect(ids(next)).toEqual(['n3', 'n2']);
        expect(next.unreadCount).toBe(8);
    });

    it('同じ通知が 2 回届いても（繋ぎ直しの取り直しと重なる）二重にせず、未読も増やさない', () => {
        const once = withStreamEvent(base, { type: 'notification', notification: follow('n3', 3) });
        const twice = withStreamEvent(once, { type: 'notification', notification: follow('n3', 3) });
        expect(ids(twice)).toEqual(['n3', 'n2']);
        expect(twice.unreadCount).toBe(8);
    });

    it('ほかのタブで既読にした（全部）なら、読み込んでいない分も含めて 0', () => {
        const next = withStreamEvent(base, { type: 'read' });
        expect(next.unreadCount).toBe(0);
        expect(next.items.every((n) => n.read)).toBe(true);
    });

    it('消えた通知を落とす。未読だった分だけ未読を減らし、知らない ID は無視する', () => {
        const state: FeedState = { ...base, items: [follow('n2', 2), follow('n1', 1, true)] };
        const next = withStreamEvent(state, { type: 'removed', ids: ['n2', 'n1', 'unknown'] });
        expect(next.items).toEqual([]);
        expect(next.unreadCount).toBe(6);
    });

    it('未読数は負にならない（サーバーの値より手元が多く減っても）', () => {
        const state: FeedState = { ...base, unreadCount: 0 };
        expect(withStreamEvent(state, { type: 'removed', ids: ['n2'] }).unreadCount).toBe(0);
    });
});

describe('既読の楽観的な更新', () => {
    const state: FeedState = {
        items: [announce('a3', 3), follow('n2', 2), announce('a1', 1), follow('n0', 0, true)],
        nextCursor: 'c',
        unreadCount: 10,
        loaded: true,
    };

    it('ID を指定すると、その通知だけが既読になる', () => {
        const { state: next, undo } = markReadLocally(state, { ids: ['n2'] });
        expect(next.items.filter((n) => n.read).map((n) => n.id)).toEqual(['n2', 'n0']);
        expect(next.unreadCount).toBe(9);
        expect(undo).toEqual({ ids: ['n2'], unreadDelta: 1 });
    });

    it('お知らせを既読にすると、それより前のお知らせも既読になる（サーバーの位置と同じ）', () => {
        const { state: next } = markReadLocally(state, { ids: ['a3'] });
        expect(next.items.filter((n) => n.read).map((n) => n.id)).toEqual(['a3', 'a1', 'n0']);
        expect(next.unreadCount).toBe(8);
    });

    it('既読のもの・知らない ID は数えない', () => {
        const { state: next, undo } = markReadLocally(state, { ids: ['n0', 'nope'] });
        expect(next.unreadCount).toBe(10);
        expect(undo.ids).toEqual([]);
    });

    it('失敗したら変えた分だけ戻す（全部を既読にした場合も、読み込んでいない分の未読まで戻す）', () => {
        const { state: optimistic, undo } = markReadLocally(state, { all: true });
        expect(optimistic.unreadCount).toBe(0);
        // 待っている間に新しい通知が届いた
        const meanwhile = withStreamEvent(optimistic, { type: 'notification', notification: follow('n9', 9) });
        const restored = undoMarkRead(meanwhile, undo);
        expect(restored.unreadCount).toBe(11);
        expect(restored.items.filter((n) => !n.read).map((n) => n.id)).toEqual(['n9', 'a3', 'n2', 'a1']);
        // 元から既読だったものは未読に戻さない
        expect(restored.items.find((n) => n.id === 'n0')?.read).toBe(true);
    });

    it('戻すまでに消えた通知は戻さない', () => {
        const { state: optimistic, undo } = markReadLocally(state, { ids: ['n2'] });
        const removed = withStreamEvent(optimistic, { type: 'removed', ids: ['n2'] });
        const restored = undoMarkRead(removed, undo);
        expect(ids(restored)).not.toContain('n2');
    });
});
