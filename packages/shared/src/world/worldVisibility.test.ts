import { describe, expect, it } from 'vitest';
import type { Instance } from '../schemas/instance.schema';
import { WorldVisibilitySchema } from '../schemas/worldVisibility.schema';
import {
    canOpenRoomPortalTo,
    canStartInstance,
    effectiveWorldVisibility,
    isPortalDestination,
    pickPortalInstance,
    worldVisibilityFromHeader,
} from './worldVisibility';

describe('effectiveWorldVisibility', () => {
    it('公開するまでは、パブリックに設定していてもプライベート', () => {
        expect(effectiveWorldVisibility('public', false)).toBe('private');
        expect(effectiveWorldVisibility('private', false)).toBe('private');
    });

    it('公開したら設定のとおり', () => {
        expect(effectiveWorldVisibility('public', true)).toBe('public');
        expect(effectiveWorldVisibility('private', true)).toBe('private');
    });

    it('知らない値は受け取らない', () => {
        expect(WorldVisibilitySchema.safeParse('unlisted').success).toBe(false);
        expect(WorldVisibilitySchema.safeParse('PUBLIC').success).toBe(false);
    });
});

describe('worldVisibilityFromHeader', () => {
    it('private・public を読む（大文字・前後の空白も）', () => {
        expect(worldVisibilityFromHeader('private')).toBe('private');
        expect(worldVisibilityFromHeader(' Private ')).toBe('private');
        expect(worldVisibilityFromHeader('PUBLIC')).toBe('public');
    });

    it('無い・知らない値はパブリックとして扱う（undefined）。private を含む別の語は private にしない', () => {
        expect(worldVisibilityFromHeader(null)).toBeUndefined();
        expect(worldVisibilityFromHeader(undefined)).toBeUndefined();
        expect(worldVisibilityFromHeader('')).toBeUndefined();
        expect(worldVisibilityFromHeader('unlisted')).toBeUndefined();
        expect(worldVisibilityFromHeader('privateish')).toBeUndefined();
    });

    it('重なったヘッダー（, でつながる）は、private が 1 つでもあれば private', () => {
        expect(worldVisibilityFromHeader('public, private')).toBe('private');
        expect(worldVisibilityFromHeader('private, private')).toBe('private');
        expect(worldVisibilityFromHeader('public, public')).toBe('public');
    });
});

describe('canStartInstance', () => {
    it('プライベートのワールドは作者だけが作れる', () => {
        const world = { visibility: 'private' as const, authorId: 'aya' };
        expect(canStartInstance(world, 'aya')).toBe(true);
        expect(canStartInstance(world, 'bob')).toBe(false);
        expect(canStartInstance(world, null)).toBe(false);
    });

    it('作者の分からないプライベートのワールドは、だれも作れない（ログインしていない人と作者の無い世界を同じとみなさない）', () => {
        expect(canStartInstance({ visibility: 'private' }, null)).toBe(false);
        expect(canStartInstance({ visibility: 'private' }, 'bob')).toBe(false);
    });

    it('パブリックと、公開範囲を持たない（外部・同梱の）ワールドはだれでも作れる', () => {
        expect(canStartInstance({ visibility: 'public', authorId: 'aya' }, 'bob')).toBe(true);
        expect(canStartInstance({}, 'bob')).toBe(true);
    });
});

describe('isPortalDestination', () => {
    it('プライベートのワールドは、作者のワールドに置くポータルでも行き先にできない', () => {
        expect(isPortalDestination({ visibility: 'private', authorId: 'aya' })).toBe(false);
        expect(isPortalDestination({ visibility: 'public' })).toBe(true);
        expect(isPortalDestination({})).toBe(true);
    });
});

describe('canOpenRoomPortalTo', () => {
    const room = (visibility: 'private' | 'public') => ({ leaderId: 'aya', world: { visibility, authorId: 'aya' } });

    it('プライベートのワールドの部屋は、部屋を作った人だけが置ける', () => {
        expect(canOpenRoomPortalTo(room('private'), 'aya')).toBe(true);
        expect(canOpenRoomPortalTo(room('private'), 'bob')).toBe(false);
        expect(canOpenRoomPortalTo(room('private'), null)).toBe(false);
    });

    it('パブリックのワールドの部屋は、だれでも置ける', () => {
        expect(canOpenRoomPortalTo(room('public'), 'bob')).toBe(true);
    });
});

describe('pickPortalInstance', () => {
    const instance = (id: string, overrides: Partial<Instance> = {}, users = 1, max = 10): Instance => ({
        id,
        status: 'active',
        leaderId: 'leader',
        createdAt: '2026-11-22T00:00:00.000Z',
        expiresAt: null,
        world: { id: 'w', version: '1', displayName: 'W', authorId: 'aya', mods: [] },
        access: { type: 'public', tags: [] },
        stats: { currentUsers: users, maxUsers: max },
        connection: { url: 'ws://x', namespace: '/' },
        ...overrides,
    });

    it('入れる部屋が無ければ null（新しく作る）', () => {
        expect(pickPortalInstance([], 'me')).toBeNull();
    });

    it('いちばん人のいる部屋を選ぶ', () => {
        const picked = pickPortalInstance([instance('a', {}, 1), instance('b', {}, 4), instance('c', {}, 2)], 'me');
        expect(picked?.id).toBe('b');
    });

    it('同じ人数なら先にできた部屋', () => {
        const older = instance('older', { createdAt: '2026-11-21T00:00:00.000Z' }, 3);
        const newer = instance('newer', { createdAt: '2026-11-22T00:00:00.000Z' }, 3);
        expect(pickPortalInstance([newer, older], 'me')?.id).toBe('older');
        expect(pickPortalInstance([older, newer], 'me')?.id).toBe('older');
    });

    it('パブリックでない・入れない・満員・ほかのサーバーの部屋は選ばない', () => {
        const rooms = [
            instance('friends', { access: { type: 'friend_plus', tags: [] } }, 9),
            instance('invite', { canJoin: false }, 9),
            instance('full', {}, 10, 10),
            instance('remote', { remote: { domain: 'other.example', url: 'https://other.example' } }, 9),
            instance('open', {}, 1),
        ];
        expect(pickPortalInstance(rooms, 'me')?.id).toBe('open');
    });

    it('満員でも作った本人なら入れるので選ぶ', () => {
        expect(pickPortalInstance([instance('mine', { leaderId: 'me' }, 10, 10)], 'me')?.id).toBe('mine');
    });
});
