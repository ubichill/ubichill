import { beforeAll, describe, expect, it } from 'vitest';
import { externalWorkRepository } from './externalWorkRepository';
import { userRepository } from './userRepository';

/** 外部の作品の登録の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const SYS = '00000000-0000-0000-0000-000000000000';
const stamp = Date.now().toString(36);
const mod = { userId: SYS, kind: 'mod', url: `https://it-${stamp}.example/mods`, name: 'pen' };
const world = { userId: SYS, kind: 'world', url: `https://it-${stamp}.example/w.yaml`, name: 'w' };

describe.skipIf(!RUN)('externalWorkRepository (DB統合)', () => {
    beforeAll(async () => {
        await userRepository.ensureSystemUser(SYS);
    });

    it('同じ作品を登録し直すと、1 件のまま版が新しくなる', async () => {
        const before = await externalWorkRepository.countByUser(SYS);
        await externalWorkRepository.registerWithinLimit({ ...mod, version: '1.0.0' }, 1000);
        await externalWorkRepository.registerWithinLimit({ ...mod, version: '1.1.0' }, 1000);
        await externalWorkRepository.registerWithinLimit({ ...world, version: null }, 1000);
        expect(await externalWorkRepository.countByUser(SYS)).toBe(before + 2);
        const found = (await externalWorkRepository.listByUser(SYS)).find((r) => r.url === mod.url);
        expect(found?.version).toBe('1.1.0');
    });

    it('種類・URL・名前のどれかが違えば別の作品', async () => {
        expect(await externalWorkRepository.remove({ ...mod, name: 'other' })).toBe(false);
        expect(await externalWorkRepository.remove({ ...mod, kind: 'world' })).toBe(false);
    });

    it('上限の中だけ登録でき、同時に登録しても上限を超えない（登録し直しは数えない）', async () => {
        const base = await externalWorkRepository.countByUser(SYS);
        const max = base + 3;
        const results = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                externalWorkRepository.registerWithinLimit(
                    { ...mod, name: `race-${stamp}-${i}`, version: '1.0.0' },
                    max,
                ),
            ),
        );
        expect(results.filter((r) => r === 'saved')).toHaveLength(3);
        expect(await externalWorkRepository.countByUser(SYS)).toBe(max);
        const savedName = `race-${stamp}-${results.indexOf('saved')}`;
        expect(
            await externalWorkRepository.registerWithinLimit({ ...mod, name: savedName, version: '2.0.0' }, max),
        ).toBe('saved');
        for (const i of Array.from({ length: 8 }, (_, n) => n)) {
            await externalWorkRepository.remove({ ...mod, name: `race-${stamp}-${i}` });
        }
    });

    it('消すと一覧から無くなり、もう一度消すと false', async () => {
        expect(await externalWorkRepository.remove(mod)).toBe(true);
        expect(await externalWorkRepository.remove(mod)).toBe(false);
        expect(await externalWorkRepository.remove(world)).toBe(true);
        expect((await externalWorkRepository.listByUser(SYS)).some((r) => r.url.includes(stamp))).toBe(false);
    });
});
