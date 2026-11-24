import { describe, expect, it } from 'vitest';
import { isIndexableEnvironment } from './indexing';

describe('isIndexableEnvironment', () => {
    it('production だけ（前後の空白・大文字は許す）', () => {
        expect(isIndexableEnvironment('production')).toBe(true);
        expect(isIndexableEnvironment(' Production ')).toBe(true);
    });

    it.each([undefined, '', 'development', 'test', 'preview', 'staging', 'productionx', 'prod'])(
        '%j は載せない',
        (environment) => {
            expect(isIndexableEnvironment(environment)).toBe(false);
        },
    );
});
