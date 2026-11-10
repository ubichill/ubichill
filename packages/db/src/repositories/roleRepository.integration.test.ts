import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roleRepository } from './roleRepository';
import { userRepository } from './userRepository';

/** ロールとアサインの保存（DB 統合）。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `role-a-${stamp}`, b: `role-b-${stamp}`, gone: `role-g-${stamp}` };
const T0 = new Date('2026-11-10T00:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);
const fields = (name: string) => ({
    name,
    description: null,
    color: '#123456',
    isPublic: true,
    isAdministrator: false,
    displayOrder: 0,
});

describe.skipIf(!RUN)('roleRepository（DB統合）', () => {
    const created: string[] = [];

    beforeAll(async () => {
        for (const id of Object.values(ids)) {
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle: id.replaceAll('-', '_') });
        }
    });

    afterAll(async () => {
        for (const id of created) await roleRepository.remove(id);
        for (const id of Object.values(ids)) await userRepository.deleteById(id).catch(() => undefined);
    });

    it('メンバーの数と一覧は期限の切れていないアサインだけを数える', async () => {
        const role = await roleRepository.create(fields(`staff-${stamp}`), T0);
        created.push(role.id);
        await roleRepository.assign({ roleId: role.id, userId: ids.a, expiresAt: null }, T0);
        await roleRepository.assign({ roleId: role.id, userId: ids.b, expiresAt: later(1000) }, T0);

        expect((await roleRepository.findById(role.id, later(999)))?.memberCount).toBe(2);
        expect((await roleRepository.findById(role.id, later(1000)))?.memberCount).toBe(1);
        expect((await roleRepository.members(role.id, later(1000))).map((m) => m.user.id)).toEqual([ids.a]);
        const listed = (await roleRepository.list(later(1000))).find((r) => r.id === role.id);
        expect(listed?.memberCount).toBe(1);
        // 判定は呼ぶ側で行うので、期限の切れたアサインも返す
        expect((await roleRepository.assignmentsOf([ids.b])).map((a) => a.role.id)).toContain(role.id);
    });

    it('付け直すと期限だけが変わり、行は 1 つのまま', async () => {
        const role = await roleRepository.create(fields(`renew-${stamp}`), T0);
        created.push(role.id);
        const first = await roleRepository.assign({ roleId: role.id, userId: ids.a, expiresAt: later(10) }, T0);
        const second = await roleRepository.assign({ roleId: role.id, userId: ids.a, expiresAt: null }, later(5));
        expect(second).toEqual({ createdAt: first.createdAt, expiresAt: null });
        expect((await roleRepository.assignmentsOf([ids.a])).filter((a) => a.role.id === role.id)).toHaveLength(1);
    });

    it('外すと消え、無いものを外すと false', async () => {
        const role = await roleRepository.create(fields(`remove-${stamp}`), T0);
        created.push(role.id);
        await roleRepository.assign({ roleId: role.id, userId: ids.a, expiresAt: null }, T0);
        expect(await roleRepository.unassign(role.id, ids.a)).toBe(true);
        expect(await roleRepository.unassign(role.id, ids.a)).toBe(false);
    });

    it('ロールを消すとアサインも消え、ユーザーを消すとそのアサインも消える', async () => {
        const role = await roleRepository.create(fields(`cascade-${stamp}`), T0);
        await roleRepository.assign({ roleId: role.id, userId: ids.a, expiresAt: null }, T0);
        await roleRepository.assign({ roleId: role.id, userId: ids.gone, expiresAt: null }, T0);

        await userRepository.deleteById(ids.gone);
        expect((await roleRepository.members(role.id, T0)).map((m) => m.user.id)).toEqual([ids.a]);

        expect(await roleRepository.remove(role.id)).toBe(true);
        expect(await roleRepository.findById(role.id)).toBeUndefined();
        expect((await roleRepository.assignmentsOf([ids.a])).some((a) => a.role.id === role.id)).toBe(false);
        expect(await roleRepository.remove(role.id)).toBe(false);
    });

    it('変更は送った値で置き換え、更新時刻を進める。無いロールは undefined', async () => {
        const role = await roleRepository.create(fields(`edit-${stamp}`), T0);
        created.push(role.id);
        const updated = await roleRepository.update(
            role.id,
            { ...fields('編集後'), isAdministrator: true, displayOrder: 3 },
            later(60_000),
        );
        expect(updated).toMatchObject({ name: '編集後', isAdministrator: true, displayOrder: 3, createdAt: T0 });
        expect(updated?.updatedAt).toEqual(later(60_000));
        expect(await roleRepository.update('missing', fields('x'))).toBeUndefined();
    });

    it('掃除は期限の切れたアサインだけを消す', async () => {
        const role = await roleRepository.create(fields(`sweep-${stamp}`), T0);
        created.push(role.id);
        await roleRepository.assign({ roleId: role.id, userId: ids.a, expiresAt: later(100) }, T0);
        await roleRepository.assign({ roleId: role.id, userId: ids.b, expiresAt: null }, T0);
        await roleRepository.deleteExpired(later(99));
        expect((await roleRepository.assignmentsOf([ids.a])).some((a) => a.role.id === role.id)).toBe(true);
        await roleRepository.deleteExpired(later(100));
        const left = await roleRepository.assignmentsOf([ids.a, ids.b]);
        expect(left.filter((a) => a.role.id === role.id).map((a) => a.userId)).toEqual([ids.b]);
    });
});
