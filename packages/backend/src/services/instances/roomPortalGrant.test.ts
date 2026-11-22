import type { RoomPortalGrantClaims, WorldVisibility } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { createRoomPortalGrants, PRIVATE_ROOM_PORTAL_MESSAGE, type RoomPortalGrantDeps } from './roomPortalGrant';

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

/** 部屋とワールドを配列で持つ偽物。許可は中身をそのまま文字列にする。 */
function fakeDeps(options: {
    rooms?: Record<string, { leaderId: string; worldRef: string }>;
    worlds?: Record<string, WorldVisibility | undefined | 'unresolvable'>;
}) {
    const rooms = options.rooms ?? {};
    const worlds = options.worlds ?? {};
    const deps = {
        selfDomain: () => 'ubichill.example',
        findRoom: vi.fn(async (id: string) => rooms[id]),
        resolveWorld: vi.fn(async (ref: string) => {
            const visibility = worlds[ref];
            return visibility === 'unresolvable'
                ? { ok: false as const }
                : { ok: true as const, world: visibility ? { visibility } : {} };
        }),
        sign: vi.fn((claims: RoomPortalGrantClaims) => JSON.stringify(claims)),
        now: () => NOW,
    } satisfies RoomPortalGrantDeps;
    return deps;
}

const PRIVATE_ROOM = { leaderId: 'aya', worldRef: 'https://ubichill.example/api/v1/authors/aya/worlds/secret.yaml' };
const PUBLIC_ROOM = { leaderId: 'aya', worldRef: 'https://ubichill.example/api/v1/authors/aya/worlds/open.yaml' };
const worlds = { [PRIVATE_ROOM.worldRef]: 'private', [PUBLIC_ROOM.worldRef]: 'public' } as const;

describe('createRoomPortalGrants', () => {
    it('プライベートのワールドの部屋へは、部屋を作った人でなければ 403（許可を出さない）', async () => {
        const deps = fakeDeps({ rooms: { secret: PRIVATE_ROOM }, worlds });
        expect(await createRoomPortalGrants(deps).issue('bob', 'secret')).toEqual({
            ok: false,
            status: 403,
            error: PRIVATE_ROOM_PORTAL_MESSAGE,
        });
        expect(deps.sign).not.toHaveBeenCalled();
    });

    it('部屋を作った人には、送ったままの住所・本人・60 秒後の期限で許可を出す', async () => {
        const deps = fakeDeps({ rooms: { secret: PRIVATE_ROOM }, worlds });
        const outcome = await createRoomPortalGrants(deps).issue('aya', 'secret');
        expect(outcome).toEqual({
            ok: true,
            grant: JSON.stringify({ room: 'secret', userId: 'aya', exp: NOW / 1000 + 60 }),
        });
    });

    it('パブリックのワールドの部屋・公開範囲の無いワールド（外部・同梱）の部屋へは、だれでも置ける', async () => {
        const deps = fakeDeps({
            rooms: { open: PUBLIC_ROOM, ext: { leaderId: 'aya', worldRef: 'https://pages.example/w.yaml' } },
            worlds: { ...worlds, 'https://pages.example/w.yaml': undefined },
        });
        const grants = createRoomPortalGrants(deps);
        expect(await grants.issue('bob', 'open')).toMatchObject({ ok: true });
        expect(await grants.issue('bob', 'ext')).toMatchObject({ ok: true });
    });

    it('部屋を作った後にプライベートにしたワールドも、いまの公開範囲で断る（部屋を作った時の値を使わない）', async () => {
        const state: { visibility: WorldVisibility } = { visibility: 'public' };
        const deps = fakeDeps({ rooms: { room: PUBLIC_ROOM } });
        deps.resolveWorld.mockImplementation(async () => ({
            ok: true as const,
            world: { visibility: state.visibility },
        }));
        const grants = createRoomPortalGrants(deps);
        expect(await grants.issue('bob', 'room')).toMatchObject({ ok: true });
        state.visibility = 'private';
        expect(await grants.issue('bob', 'room')).toMatchObject({ ok: false, status: 403 });
    });

    it('ワールドを確かめられなければプライベートとして扱う（作った人だけ）', async () => {
        const deps = fakeDeps({
            rooms: { gone: { leaderId: 'aya', worldRef: 'gone' } },
            worlds: { gone: 'unresolvable' },
        });
        const grants = createRoomPortalGrants(deps);
        expect(await grants.issue('bob', 'gone')).toMatchObject({ ok: false, status: 403 });
        expect(await grants.issue('aya', 'gone')).toMatchObject({ ok: true });
    });

    it('無い部屋は 404', async () => {
        expect(await createRoomPortalGrants(fakeDeps({})).issue('aya', 'missing')).toMatchObject({
            ok: false,
            status: 404,
        });
    });

    it('このサーバーのドメインを付けた住所はこのサーバーの部屋として確かめ、許可は送ったままの文字列に出す', async () => {
        const deps = fakeDeps({ rooms: { secret: PRIVATE_ROOM }, worlds });
        const grants = createRoomPortalGrants(deps);
        expect(await grants.issue('bob', 'secret@UBICHILL.example')).toMatchObject({ ok: false, status: 403 });
        expect(deps.findRoom).toHaveBeenCalledWith('secret');
        const own = await grants.issue('aya', 'secret@UBICHILL.example');
        expect(own.ok && JSON.parse(own.grant)).toMatchObject({ room: 'secret@UBICHILL.example' });
    });

    it('ほかのサーバーの部屋は引かずに許可する（入れる人は部屋のサーバーが決める）', async () => {
        const deps = fakeDeps({});
        expect(await createRoomPortalGrants(deps).issue('bob', 'secret@other.example')).toMatchObject({ ok: true });
        expect(deps.findRoom).not.toHaveBeenCalled();
    });

    it('住所の書式が違えば 400（インスタンスと同じ判定）', async () => {
        const grants = createRoomPortalGrants(fakeDeps({}));
        for (const room of [
            '',
            'a@',
            '@x',
            'a@b@c',
            'a b',
            '../admin',
            `${'a'.repeat(65)}`,
            `a@${'x'.repeat(320)}.com`,
        ]) {
            expect(await grants.issue('aya', room), room).toMatchObject({ ok: false, status: 400 });
        }
    });
});
