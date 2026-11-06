import { describe, expect, it } from 'vitest';
import { instanceIdFromPath, readDevMeta } from './location';

describe('instanceIdFromPath', () => {
    it('ルートは default、パスの最後の要素がインスタンス ID', () => {
        expect(instanceIdFromPath('/')).toBe('default');
        expect(instanceIdFromPath('')).toBe('default');
        expect(instanceIdFromPath('/room-1')).toBe('room-1');
        expect(instanceIdFromPath('/room-1/')).toBe('room-1');
        expect(instanceIdFromPath('/a/b')).toBe('b');
    });
    it('world.html を直接開いても ID にしない。エンコードは戻す', () => {
        expect(instanceIdFromPath('/world.html')).toBe('default');
        expect(instanceIdFromPath('/dev-x/world.html')).toBe('dev-x');
        expect(instanceIdFromPath('/%E9%83%A8%E5%B1%8B')).toBe('部屋');
    });
});

describe('readDevMeta', () => {
    const doc = (html: string) => ({
        querySelector: (selector: string) =>
            selector === 'meta[name="ubichill-dev"]' && html.includes('name="ubichill-dev"') ? {} : null,
    });
    it('meta があるときだけ dev。クエリやハッシュでは決まらない', () => {
        expect(readDevMeta(doc('<meta name="ubichill-dev">'))).toBe(true);
        expect(readDevMeta(doc('<meta name="viewport">'))).toBe(false);
    });
});
