import { beforeAll, describe, expect, it } from 'vitest';

/**
 * favoriteRepository の DB 統合テスト。DATABASE_URL がある時だけ走る。
 * add は冪等、remove で消えることと list の往復を検証する。
 */

const RUN = !!process.env.DATABASE_URL;
const SYS = '00000000-0000-0000-0000-000000000000';
const REF = 'https://example.com/api/v1/worlds/fav-test';

describe.skipIf(!RUN)('favoriteRepository (DB統合)', () => {
    let favoriteRepository: typeof import('./favoriteRepository').favoriteRepository;
    let userRepository: typeof import('./userRepository').userRepository;

    beforeAll(async () => {
        ({ favoriteRepository } = await import('./favoriteRepository'));
        ({ userRepository } = await import('./userRepository'));
        await userRepository.ensureSystemUser(SYS);
        await favoriteRepository.remove(SYS, REF); // クリーンスタート
    });

    it('add → list に現れる。二重 add は冪等（重複しない）', async () => {
        await favoriteRepository.add(SYS, REF);
        await favoriteRepository.add(SYS, REF);
        const list = await favoriteRepository.list(SYS);
        expect(list.filter((r) => r === REF)).toHaveLength(1);
    });

    it('remove で list から消える', async () => {
        await favoriteRepository.remove(SYS, REF);
        const list = await favoriteRepository.list(SYS);
        expect(list).not.toContain(REF);
    });
});
