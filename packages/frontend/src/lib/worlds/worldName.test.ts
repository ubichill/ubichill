import { describe, expect, it } from 'vitest';
import { toWorldName, WORLD_NAME_MAX_LENGTH } from './worldName';

describe('toWorldName', () => {
    it('英小文字・数字・- にそろえる', () => {
        expect(toWorldName('My World 2')).toBe('my-world-2');
        expect(toWorldName('chill_wa')).toBe('chill-wa');
    });

    it('日本語や記号の並びは 1 つの - にまとめる', () => {
        expect(toWorldName('ちるわ!!room')).toBe('-room');
        expect(toWorldName('a--b')).toBe('a-b');
    });

    it('入力の途中の末尾の - は残し、長さは上限で切る', () => {
        expect(toWorldName('my-')).toBe('my-');
        expect(toWorldName('a'.repeat(80))).toHaveLength(WORLD_NAME_MAX_LENGTH);
    });
});
