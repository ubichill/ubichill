import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instanceRepository } from './instanceRepository';
import { inviteRepository } from './inviteRepository';
import { userRepository } from './userRepository';

/** 招待とリクエストインバイトの保存（DB 統合）。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { leader: `inv-l-${stamp}`, guest: `inv-g-${stamp}`, other: `inv-o-${stamp}` };
const T0 = new Date('2026-11-07T00:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

describe.skipIf(!RUN)('inviteRepository（DB統合）', () => {
    const rooms: string[] = [];

    beforeAll(async () => {
        for (const id of Object.values(ids)) {
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle: id.replaceAll('-', '_') });
        }
        for (const n of [1, 2]) {
            const room = await instanceRepository.create({
                worldRef: `https://world.test/${stamp}-${n}.yaml`,
                leaderId: ids.leader,
                accessType: 'invite_only',
            });
            rooms.push(room.id);
        }
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('送り直すと同じ招待の期限と一言を新しくする（同じ部屋・同じ相手には 1 つ）', async () => {
        const room = rooms[0] as string;
        const first = await inviteRepository.upsert(
            { instanceId: room, inviterId: ids.leader, inviteeId: ids.guest, message: 'a', expiresAt: later(1000) },
            T0,
        );
        const second = await inviteRepository.upsert(
            { instanceId: room, inviterId: ids.leader, inviteeId: ids.guest, message: 'b', expiresAt: later(5000) },
            later(10),
        );
        expect(second.id).toBe(first.id);
        expect(second).toMatchObject({ message: 'b', expiresAt: later(5000) });
    });

    it('期限内の招待だけが効く。期限の時刻ちょうどで切れる', async () => {
        const room = rooms[0] as string;
        expect(await inviteRepository.findValid(room, ids.guest, later(4999))).toBeDefined();
        expect(await inviteRepository.findValid(room, ids.guest, later(5000))).toBeUndefined();
        expect(await inviteRepository.findValid(room, ids.other, T0)).toBeUndefined();
    });

    it('招待を持っている部屋だけを、渡した部屋の中から返す', async () => {
        const got = await inviteRepository.validInstanceIdsFor(ids.guest, rooms, later(100));
        expect([...got]).toEqual([rooms[0]]);
        expect((await inviteRepository.validInstanceIdsFor(ids.guest, [], T0)).size).toBe(0);
    });

    it('期限内のリクエストがあれば作らず、期限が過ぎていれば作り直す', async () => {
        const input = { requesterId: ids.guest, targetId: ids.leader, expiresAt: later(1000) };
        expect(await inviteRepository.createRequest(input, T0)).toBe('created');
        expect(await inviteRepository.createRequest({ ...input, expiresAt: later(9000) }, later(500))).toBe('exists');
        expect(await inviteRepository.hasRequest(ids.guest, ids.leader, later(999))).toBe(true);
        expect(await inviteRepository.hasRequest(ids.guest, ids.leader, later(1000))).toBe(false);
        expect(await inviteRepository.createRequest({ ...input, expiresAt: later(9000) }, later(1000))).toBe('created');
        expect(await inviteRepository.hasRequest(ids.guest, ids.leader, later(8000))).toBe(true);
        // 向きが違えば別のリクエスト
        expect(await inviteRepository.hasRequest(ids.leader, ids.guest, later(10))).toBe(false);
    });

    it('リクエストを片付けると、あったかどうかを返す', async () => {
        expect(await inviteRepository.removeRequest(ids.guest, ids.leader)).toBe(true);
        expect(await inviteRepository.removeRequest(ids.guest, ids.leader)).toBe(false);
    });

    it('部屋が消えたら招待も消える', async () => {
        const room = rooms[1] as string;
        await inviteRepository.upsert(
            { instanceId: room, inviterId: ids.leader, inviteeId: ids.other, message: null, expiresAt: later(1000) },
            T0,
        );
        await instanceRepository.delete(room);
        expect(await inviteRepository.findValid(room, ids.other, T0)).toBeUndefined();
    });

    it('期限の過ぎた招待とリクエストを掃除する', async () => {
        await inviteRepository.createRequest(
            { requesterId: ids.other, targetId: ids.leader, expiresAt: later(10) },
            T0,
        );
        const removed = await inviteRepository.deleteExpired(later(100_000));
        expect(removed).toBeGreaterThanOrEqual(2);
        expect(await inviteRepository.findValid(rooms[0] as string, ids.guest, T0)).toBeUndefined();
    });

    it('2 人の間の招待とリクエストを向きによらず消す（ほかの人との分は残す）', async () => {
        const room = rooms[0] as string;
        await inviteRepository.upsert(
            { instanceId: room, inviterId: ids.guest, inviteeId: ids.leader, message: null, expiresAt: later(1000) },
            T0,
        );
        await inviteRepository.upsert(
            { instanceId: room, inviterId: ids.leader, inviteeId: ids.other, message: null, expiresAt: later(1000) },
            T0,
        );
        await inviteRepository.createRequest(
            { requesterId: ids.leader, targetId: ids.guest, expiresAt: later(1000) },
            T0,
        );
        await inviteRepository.removeBetween(ids.leader, ids.guest);
        expect(await inviteRepository.findValid(room, ids.leader, T0)).toBeUndefined();
        expect(await inviteRepository.hasRequest(ids.leader, ids.guest, T0)).toBe(false);
        expect(await inviteRepository.findValid(room, ids.other, T0)).toBeDefined();
        await inviteRepository.removeBetween(ids.leader, ids.other);
    });
});
