import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSetting, removeSetting, writeSetting } from './store';

/** テスト用のインメモリ localStorage スタブ。 */
function createMemoryStorage() {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        get size() {
            return map.size;
        },
    };
}

let storage: ReturnType<typeof createMemoryStorage>;

beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('writeSetting / readSetting', () => {
    it('保存した値を JSON 経由で復元する', () => {
        writeSetting('k', { a: 1, b: ['x'] });
        expect(readSetting('k', null)).toEqual({ a: 1, b: ['x'] });
    });

    it('未設定キーは fallback を返す', () => {
        expect(readSetting('missing', 'default')).toBe('default');
    });

    it('JSON 破損値は fallback を返す', () => {
        storage.setItem('broken', '{ not json');
        expect(readSetting('broken', 42)).toBe(42);
    });

    it('型ガード不一致は fallback を返す', () => {
        writeSetting('n', 'text');
        const isNumber = (v: unknown): v is number => typeof v === 'number';
        expect(readSetting('n', 0, isNumber)).toBe(0);
    });

    it('型ガード一致ならその値を返す', () => {
        writeSetting('n', 7);
        const isNumber = (v: unknown): v is number => typeof v === 'number';
        expect(readSetting('n', 0, isNumber)).toBe(7);
    });
});

describe('removeSetting', () => {
    it('保存値を削除する', () => {
        writeSetting('k', 1);
        removeSetting('k');
        expect(readSetting('k', 'gone')).toBe('gone');
    });
});

describe('堅牢性', () => {
    it('localStorage が例外を投げても write は落ちない', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => null,
            setItem: () => {
                throw new Error('QuotaExceeded');
            },
            removeItem: () => {},
        });
        expect(() => writeSetting('k', 'v')).not.toThrow();
    });

    it('localStorage 自体が無い環境でも read は fallback を返す', () => {
        vi.stubGlobal('localStorage', undefined);
        expect(readSetting('k', 'fallback')).toBe('fallback');
    });
});
