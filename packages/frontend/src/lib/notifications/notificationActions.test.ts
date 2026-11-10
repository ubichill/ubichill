import type { AppNotification } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { type NotificationContext, notificationActionsOf, notificationDetailOf } from './notificationActions';

const actor = { type: 'Person', id: 'alice', name: 'Alice', preferredUsername: 'alice', icon: null } as const;
const base = { actor, published: '2026-10-01T00:00:00.000Z', read: false };
const NOW = Date.parse('2026-10-01T00:30:00.000Z');
const ctx = (over: Partial<NotificationContext> = {}): NotificationContext => ({
    pendingFollow: false,
    now: NOW,
    currentInstanceId: null,
    inLaunchpad: true,
    ...over,
});

const follow: AppNotification = { ...base, id: '1', type: 'Follow', object: { type: 'Person', id: 'me' } };
const invite: AppNotification = {
    ...base,
    id: '2',
    type: 'Invite',
    object: { type: 'Instance', id: 'room', name: 'カフェ', image: null },
    content: 'おいで',
    endTime: '2026-10-01T01:00:00.000Z',
};
const join: AppNotification = {
    ...base,
    id: '3',
    type: 'Join',
    object: { type: 'Person', id: 'me' },
    endTime: '2026-10-01T01:00:00.000Z',
};
const message: AppNotification = {
    ...base,
    id: '4',
    type: 'Create',
    object: { type: 'Note', id: 'm1', content: 'こんにちは\n元気？' },
};
const announce: AppNotification = {
    ...base,
    id: '5',
    type: 'Announce',
    object: { type: 'Note', id: 'a1', summary: 'メンテ', content: '本文' },
};
const followRequest: AppNotification = {
    ...base,
    id: '6',
    type: 'FediverseFollowRequest',
    object: { type: 'Person', id: 'me' },
};

describe('notificationActionsOf', () => {
    it('返事をしていない申請は承認・拒否。返事をしたあとはプロフィールだけ', () => {
        expect(notificationActionsOf(follow, ctx({ pendingFollow: true }))).toEqual([
            'accept-friend',
            'decline-friend',
            'view-profile',
        ]);
        expect(notificationActionsOf(follow, ctx())).toEqual(['view-profile']);
    });

    it('フェディバースのフォローリクエストは承認・拒否（フレンドの申請とは別の操作）', () => {
        expect(notificationActionsOf(followRequest, ctx())).toEqual([
            'approve-follower',
            'reject-follower',
            'view-profile',
        ]);
    });

    it('招待: 期限内でいまの部屋でなければ「入る」。期限ちょうどで切れる', () => {
        expect(notificationActionsOf(invite, ctx())).toEqual(['enter', 'view-profile']);
        expect(notificationActionsOf(invite, ctx({ currentInstanceId: 'room' }))).toEqual(['view-profile']);
        expect(notificationActionsOf(invite, ctx({ now: Date.parse('2026-10-01T01:00:00.000Z') }))).toEqual([
            'view-profile',
        ]);
    });

    it('ランチパッドの外（ユーザーページなど）でも、招待には入れる', () => {
        expect(notificationActionsOf(invite, ctx({ inLaunchpad: false }))).toContain('enter');
    });

    it('リクエストインバイト: 期限内なら招待する・断る。期限を過ぎたら答えられない', () => {
        expect(notificationActionsOf(join, ctx())).toEqual([
            'accept-invite-request',
            'decline-invite-request',
            'view-profile',
        ]);
        expect(notificationActionsOf(join, ctx({ now: Date.parse('2026-10-02T00:00:00.000Z') }))).toEqual([
            'view-profile',
        ]);
    });

    it('メッセージの会話はランチパッドの中だけで開ける', () => {
        expect(notificationActionsOf(message, ctx())).toEqual(['open-conversation', 'view-profile']);
        expect(notificationActionsOf(message, ctx({ inLaunchpad: false }))).toEqual(['view-profile']);
    });

    it('お知らせにはプロフィールを出さない。handle の無い相手にも出さない', () => {
        expect(notificationActionsOf(announce, ctx())).toEqual([]);
        const anonymous: AppNotification = {
            ...base,
            actor: { ...actor, preferredUsername: null },
            id: '7',
            type: 'Follow',
            object: { type: 'Person', id: 'me' },
        };
        expect(notificationActionsOf(anonymous, ctx())).toEqual([]);
    });
});

describe('notificationDetailOf', () => {
    it('お知らせは本文、招待は一言、メッセージは 1 行にした冒頭。ほかは無し', () => {
        expect(notificationDetailOf(announce)).toBe('本文');
        expect(notificationDetailOf(invite)).toBe('おいで');
        expect(notificationDetailOf(message)).toBe('こんにちは 元気？');
        expect(notificationDetailOf(follow)).toBeNull();
    });
});
