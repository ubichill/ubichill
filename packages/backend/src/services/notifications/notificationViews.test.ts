import type { AnnouncementRecord, NotificationRecord } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import { sampleNotification } from './notificationBusContract';
import { announcementNotificationOf, mergeFeedPage, notificationOf } from './notificationViews';

const record = (over: Partial<NotificationRecord> = {}): NotificationRecord => ({
    id: 'n1',
    recipientId: 'bob',
    type: 'Follow',
    actorUserId: 'alice',
    actorUri: null,
    actorName: 'Alice',
    actorHandle: 'alice',
    actorImage: null,
    object: { type: 'Person', id: 'bob' },
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    readAt: null,
    ...over,
});

describe('notificationOf', () => {
    it('行を AS2 の形にする', () => {
        expect(notificationOf(record())).toMatchObject({
            type: 'Follow',
            actor: { type: 'Person', id: 'alice', preferredUsername: 'alice' },
            read: false,
        });
    });

    it('種類と object を取り違えた行・知らない種類・actor の消えた行は出さない', () => {
        expect(notificationOf(record({ type: 'Like' }))).toBeUndefined();
        expect(notificationOf(record({ type: 'Delete' }))).toBeUndefined();
        expect(notificationOf(record({ actorName: null }))).toBeUndefined();
        expect(notificationOf(record({ actorUserId: null, actorUri: 'https://r.example/u' }))).toBeUndefined();
    });
});

describe('announcementNotificationOf', () => {
    const ann: AnnouncementRecord = {
        id: 'a1',
        authorId: null,
        authorName: null,
        authorHandle: null,
        authorImage: null,
        title: 't',
        content: 'c',
        publishedAt: new Date('2026-10-02T00:00:00.000Z'),
    };
    it('作者が消えていても運営の名義で出し、既読は位置で決める（同じ時刻は既読）', () => {
        expect(announcementNotificationOf(ann, ann.publishedAt)).toMatchObject({
            type: 'Announce',
            actor: { id: 'ubichill' },
            read: true,
        });
        expect(announcementNotificationOf(ann, new Date(ann.publishedAt.getTime() - 1))?.read).toBe(false);
    });
});

describe('mergeFeedPage', () => {
    const at = (id: string, iso: string) => ({ ...sampleNotification(id), published: iso });
    it('2 つの並びを新しい順に混ぜ、余りがあれば最後の位置をカーソルにする', () => {
        const page = mergeFeedPage(
            [
                [at('n3', '2026-10-03T00:00:00.000Z'), at('n1', '2026-10-01T00:00:00.000Z')],
                [at('a2', '2026-10-02T00:00:00.000Z')],
            ],
            2,
        );
        expect(page.items.map((i) => i.id)).toEqual(['n3', 'a2']);
        expect(page.nextCursor).not.toBeNull();
    });

    it('ちょうど limit なら次は無い', () => {
        expect(mergeFeedPage([[at('n1', '2026-10-01T00:00:00.000Z')], []], 1).nextCursor).toBeNull();
    });
});
