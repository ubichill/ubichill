import { describe, expect, it } from 'vitest';
import { LIMITS } from '../schemas/world.schema';
import { limitsFor } from './limits';

describe('limitsFor', () => {
    it('今は誰でも同じ定数を返す（ワールドの数と版の数を 1 か所で決める）', () => {
        expect(limitsFor({ id: 'a' })).toEqual({
            maxWorlds: LIMITS.MAX_WORLDS_PER_USER,
            maxVersionsPerWorld: LIMITS.MAX_VERSIONS_PER_WORLD,
        });
        expect(limitsFor({ id: 'b' })).toEqual(limitsFor({ id: 'a' }));
    });

    it('版は少なくとも 1 つ残す（0 だと公開中の版まで消える）', () => {
        expect(limitsFor({ id: 'a' }).maxVersionsPerWorld).toBeGreaterThanOrEqual(1);
    });
});
