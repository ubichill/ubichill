import { describe, expect, it } from 'vitest';
import {
    canJoinInstance,
    canSeeInstance,
    type InstanceAudience,
    inviteRefusal,
    inviteRequestRefusal,
    SendInvitesRequestSchema,
} from './instanceAccess';

const audience = (accessType: InstanceAudience['accessType'], memberIds: string[] = []): InstanceAudience => ({
    accessType,
    leaderId: 'leader',
    memberIds,
});
const none = new Set<string>();
const friendOfLeader = new Set(['leader']);
const friendOfMember = new Set(['m1']);

describe('canSeeInstance / canJoinInstance', () => {
    it('パブリックはログインしていなくても見える。入るにはログインが要る', () => {
        expect(canSeeInstance(audience('public'), null, none)).toBe(true);
        expect(canJoinInstance(audience('public'), null, none)).toBe(false);
        expect(canJoinInstance(audience('public'), 'v', none)).toBe(true);
    });

    it('ログインしていなければ、パブリック以外は見えない（フレンドの集合を渡されても）', () => {
        for (const type of ['friend_plus', 'friend_only', 'invite_only'] as const) {
            expect(canSeeInstance(audience(type, ['m1']), null, friendOfMember)).toBe(false);
        }
    });

    it('フレンドのみ: 作成者のフレンドだけ。参加者のフレンドでは見えない', () => {
        expect(canSeeInstance(audience('friend_only', ['m1']), 'v', friendOfLeader)).toBe(true);
        expect(canSeeInstance(audience('friend_only', ['m1']), 'v', friendOfMember)).toBe(false);
        expect(canJoinInstance(audience('friend_only'), 'v', none)).toBe(false);
    });

    it('フレンド+: 中にいる誰かのフレンドなら見えて入れる', () => {
        expect(canSeeInstance(audience('friend_plus', ['m1']), 'v', friendOfMember)).toBe(true);
        expect(canJoinInstance(audience('friend_plus', ['m1']), 'v', friendOfMember)).toBe(true);
        expect(canSeeInstance(audience('friend_plus', ['m1']), 'v', none)).toBe(false);
    });

    it('招待のみ: 中にいる人のフレンドには見えるが、招待が無ければ入れない', () => {
        expect(canSeeInstance(audience('invite_only', ['m1']), 'v', friendOfLeader)).toBe(true);
        expect(canSeeInstance(audience('invite_only', ['m1']), 'v', friendOfMember)).toBe(true);
        expect(canJoinInstance(audience('invite_only', ['m1']), 'v', friendOfLeader)).toBe(false);
        expect(canJoinInstance(audience('invite_only', ['m1']), 'v', friendOfLeader, { invited: true })).toBe(true);
    });

    it('招待のみ: フレンドでない人には URL を知っていても見えず、入れない', () => {
        expect(canSeeInstance(audience('invite_only'), 'v', none)).toBe(false);
        expect(canJoinInstance(audience('invite_only'), 'v', none)).toBe(false);
    });

    it('招待された人は、見えない部屋（フレンドのみで作成者のフレンドでない）にも入れる', () => {
        expect(canSeeInstance(audience('friend_only'), 'v', none)).toBe(false);
        expect(canJoinInstance(audience('friend_only'), 'v', none, { invited: true })).toBe(true);
    });

    it('招待はログインしていない人には効かない', () => {
        expect(canJoinInstance(audience('invite_only'), null, none, { invited: true })).toBe(false);
    });

    it('作成者と参加している人にはいつも見えて入れる（フレンドでなくても）', () => {
        expect(canSeeInstance(audience('invite_only'), 'leader', none)).toBe(true);
        expect(canJoinInstance(audience('invite_only'), 'leader', none)).toBe(true);
        expect(canSeeInstance(audience('friend_only', ['v']), 'v', none)).toBe(true);
        expect(canJoinInstance(audience('invite_only', ['v']), 'v', none)).toBe(true);
    });
});

describe('inviteRefusal', () => {
    const friends = (inviter: string[], leader: string[] = []) => ({
        inviter: new Set(inviter),
        leader: new Set(leader),
    });

    it('作成者はどの公開範囲でもフレンドを招待できる', () => {
        for (const type of ['public', 'friend_plus', 'friend_only', 'invite_only'] as const) {
            expect(inviteRefusal(audience(type), 'leader', 't', friends(['t']))).toBeNull();
        }
    });

    it('作成者以外: パブリック・フレンド+ には送れる', () => {
        expect(inviteRefusal(audience('public', ['s']), 's', 't', friends(['t']))).toBeNull();
        expect(inviteRefusal(audience('friend_plus', ['s']), 's', 't', friends(['t']))).toBeNull();
    });

    it('作成者以外: フレンドのみ・招待のみには、相手が作成者のフレンドのときだけ送れる', () => {
        for (const type of ['friend_only', 'invite_only'] as const) {
            expect(inviteRefusal(audience(type, ['s']), 's', 't', friends(['t']))).toBe('needs-leader');
            expect(inviteRefusal(audience(type, ['s']), 's', 't', friends(['t'], ['t']))).toBeNull();
        }
    });

    it('部屋にいない人は送れない（作成者のフレンドでも、URL を知っていても）', () => {
        expect(inviteRefusal(audience('public'), 's', 't', friends(['t'], ['t']))).toBe('not-inside');
    });

    it('フレンドでない相手には送れない（作成者でも）', () => {
        expect(inviteRefusal(audience('public'), 'leader', 'stranger', friends([]))).toBe('not-friend');
    });

    it('自分自身・もう部屋にいる人には送らない', () => {
        expect(inviteRefusal(audience('public', ['s']), 's', 's', friends(['s']))).toBe('self');
        expect(inviteRefusal(audience('public', ['s', 't']), 's', 't', friends(['t']))).toBe('already-inside');
        expect(inviteRefusal(audience('public', ['s']), 's', 'leader', friends(['leader']))).toBe('already-inside');
    });
});

describe('inviteRequestRefusal', () => {
    const friendsOfMe = new Set(['f']);

    it('招待が要る部屋にいるフレンドには頼める', () => {
        expect(inviteRequestRefusal('me', 'f', friendsOfMe, audience('invite_only', ['f']))).toBeNull();
        expect(
            inviteRequestRefusal('me', 'f', friendsOfMe, {
                ...audience('friend_only'),
                leaderId: 'x',
                memberIds: ['f'],
            }),
        ).toBeNull();
    });

    it('もう入れる部屋なら頼まない（そのまま入る）', () => {
        expect(inviteRequestRefusal('me', 'f', friendsOfMe, audience('friend_plus', ['f']))).toBe('can-join');
        expect(inviteRequestRefusal('me', 'f', friendsOfMe, audience('public', ['f']))).toBe('can-join');
    });

    it('ほかのサーバーの部屋にいるフレンドには頼める（入れるかは部屋のサーバーが決める）。フレンドでなければ頼めない', () => {
        expect(inviteRequestRefusal('me', 'f', friendsOfMe, 'remote')).toBeNull();
        expect(inviteRequestRefusal('me', 'x', friendsOfMe, 'remote')).toBe('not-friend');
    });

    it('ほかのサーバーのフレンドの actor の URL も ID として扱う', () => {
        const remote = 'https://b.example/ap/users/f';
        expect(inviteRequestRefusal('me', remote, new Set([remote]), 'remote')).toBeNull();
        expect(SendInvitesRequestSchema.safeParse({ userIds: [remote] }).success).toBe(true);
    });

    it('部屋にいない・フレンドでない・自分自身には頼めない', () => {
        expect(inviteRequestRefusal('me', 'f', friendsOfMe, null)).toBe('offline');
        expect(inviteRequestRefusal('me', 'x', friendsOfMe, audience('invite_only', ['x']))).toBe('not-friend');
        expect(inviteRequestRefusal('me', 'me', new Set(['me']), audience('invite_only', ['me']))).toBe('self');
    });
});

describe('SendInvitesRequestSchema', () => {
    it('一言は前後の空白を落として 80 字まで。人数は 1〜20', () => {
        expect(SendInvitesRequestSchema.parse({ userIds: ['a'], message: '  やあ  ' }).message).toBe('やあ');
        expect(SendInvitesRequestSchema.safeParse({ userIds: ['a'], message: 'あ'.repeat(81) }).success).toBe(false);
        expect(SendInvitesRequestSchema.safeParse({ userIds: [] }).success).toBe(false);
        expect(
            SendInvitesRequestSchema.safeParse({ userIds: Array.from({ length: 21 }, (_, i) => `u${i}`) }).success,
        ).toBe(false);
    });

    it('知らない項目は受け取らない', () => {
        expect(SendInvitesRequestSchema.safeParse({ userIds: ['a'], expiresAt: 'never' }).success).toBe(false);
    });
});
