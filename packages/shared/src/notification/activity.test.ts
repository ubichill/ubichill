import { describe, expect, it } from 'vitest';
import {
    type AppNotification,
    decodeFeedCursor,
    encodeFeedCursor,
    MarkReadRequestSchema,
    NotificationSchema,
    NotificationStreamEventSchema,
    parseNotificationObject,
    sortFeed,
} from './activity';

const actor = { type: 'Person', id: 'user_abc-1', name: 'Alice', preferredUsername: 'alice', icon: null } as const;
const follow = {
    id: 'n1',
    type: 'Follow',
    actor,
    object: { type: 'Person', id: 'bob' },
    published: '2026-10-01T00:00:00.000Z',
    read: false,
};

describe('NotificationSchema', () => {
    it('種類ごとの正しい形を通す', () => {
        expect(NotificationSchema.safeParse(follow).success).toBe(true);
        const like = {
            ...follow,
            type: 'Like',
            object: { type: 'World', id: 'https://ubichill.com/api/v1/authors/bob/worlds/w.yaml', name: 'W' },
        };
        expect(NotificationSchema.safeParse(like).success).toBe(true);
        const announce = {
            ...follow,
            type: 'Announce',
            object: { type: 'Note', id: 'a1', summary: 'メンテナンス', content: '明日 10 時から' },
        };
        expect(NotificationSchema.safeParse(announce).success).toBe(true);
    });

    it('リモートの actor（https の URI）も受ける', () => {
        const remote = { ...follow, actor: { ...actor, id: 'https://other.example/users/carol' } };
        expect(NotificationSchema.safeParse(remote).success).toBe(true);
    });

    it.each([
        ['http の URI', 'http://other.example/users/carol'],
        ['認証情報入りの URI', 'https://user:pass@other.example/u'],
        ['javascript: の URI', 'javascript:alert(1)'],
        ['空', ''],
        ['空白入り', 'a b'],
        ['長すぎる ID', 'a'.repeat(65)],
    ])('不正な actor の id（%s）を落とす', (_label, id) => {
        expect(NotificationSchema.safeParse({ ...follow, actor: { ...actor, id } }).success).toBe(false);
    });

    it('actor の種類が Person でなければ落とす・余計な項目も落とす', () => {
        expect(NotificationSchema.safeParse({ ...follow, actor: { ...actor, type: 'Service' } }).success).toBe(false);
        expect(NotificationSchema.safeParse({ ...follow, actor: { ...actor, admin: true } }).success).toBe(false);
    });

    it('種類と object の取り違えを落とす', () => {
        // Follow に Note、Like に Person、Accept に World
        expect(
            NotificationSchema.safeParse({
                ...follow,
                object: { type: 'Note', id: 'a1', summary: 's', content: 'c' },
            }).success,
        ).toBe(false);
        expect(NotificationSchema.safeParse({ ...follow, type: 'Like' }).success).toBe(false);
        expect(
            NotificationSchema.safeParse({
                ...follow,
                type: 'Accept',
                object: { type: 'World', id: 'https://x.example/w.yaml', name: 'w' },
            }).success,
        ).toBe(false);
    });

    it('知らない種類・時刻の形の誤りを落とす', () => {
        expect(NotificationSchema.safeParse({ ...follow, type: 'Delete' }).success).toBe(false);
        expect(NotificationSchema.safeParse({ ...follow, published: '昨日' }).success).toBe(false);
    });

    it('Like の object の URL が URL でなければ落とす', () => {
        expect(parseNotificationObject('Like', { type: 'World', id: 'not a url', name: 'w' })).toBeUndefined();
    });
});

describe('parseNotificationObject', () => {
    it('DB の jsonb を種類で確かめる', () => {
        expect(parseNotificationObject('Follow', { type: 'Person', id: 'bob' })).toEqual({ type: 'Person', id: 'bob' });
        expect(parseNotificationObject('Accept', { type: 'Person', id: 'bob' })).toBeUndefined();
        expect(parseNotificationObject('Accept', { type: 'Follow', actor: 'a', object: 'b' })).toEqual({
            type: 'Follow',
            actor: 'a',
            object: 'b',
        });
        expect(parseNotificationObject('Follow', null)).toBeUndefined();
    });
});

describe('MarkReadRequestSchema', () => {
    it('ids か all のどちらか', () => {
        expect(MarkReadRequestSchema.safeParse({ ids: ['a'] }).success).toBe(true);
        expect(MarkReadRequestSchema.safeParse({ all: true }).success).toBe(true);
        expect(MarkReadRequestSchema.safeParse({ all: false }).success).toBe(false);
        expect(MarkReadRequestSchema.safeParse({ ids: [] }).success).toBe(false);
        expect(MarkReadRequestSchema.safeParse({ ids: ['a'], all: true }).success).toBe(false);
        expect(MarkReadRequestSchema.safeParse({ ids: Array.from({ length: 101 }, (_, i) => `n${i}`) }).success).toBe(
            false,
        );
    });
});

describe('NotificationStreamEventSchema', () => {
    it('中の通知も確かめる', () => {
        expect(NotificationStreamEventSchema.safeParse({ type: 'notification', notification: follow }).success).toBe(
            true,
        );
        expect(
            NotificationStreamEventSchema.safeParse({
                type: 'notification',
                notification: { ...follow, actor: { ...actor, id: 'http://x' } },
            }).success,
        ).toBe(false);
        expect(NotificationStreamEventSchema.safeParse({ type: 'removed', ids: [] }).success).toBe(false);
    });
});

describe('一覧のカーソル', () => {
    it('往復できる', () => {
        const p = { publishedMs: Date.parse('2026-10-01T00:00:00.123Z'), id: 'n_1-x' };
        expect(decodeFeedCursor(encodeFeedCursor(p))).toEqual(p);
    });

    it.each(['', 'abc', '.n1', 'zz.', 'zzzzzzzzzzzzz.n1', '1.n 1', '1.n1;drop'])(
        '壊れたカーソル %j は undefined',
        (c) => {
            expect(decodeFeedCursor(c)).toBeUndefined();
        },
    );

    it('新しい順、同じ時刻は id の降順', () => {
        const at = '2026-10-01T00:00:00.000Z';
        const items = [
            { id: 'a', published: at },
            { id: 'c', published: '2026-09-01T00:00:00.000Z' },
            { id: 'b', published: at },
        ] as Pick<AppNotification, 'id' | 'published'>[];
        expect(sortFeed(items).map((n) => n.id)).toEqual(['b', 'a', 'c']);
    });
});
