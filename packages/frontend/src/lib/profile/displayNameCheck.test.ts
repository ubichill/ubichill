import { describe, expect, it } from 'vitest';
import { canSaveDisplayName, checkDisplayName, type DisplayNameCheckInput } from './displayNameCheck';

const now = new Date('2026-11-01T00:00:00Z');
const base: DisplayNameCheckInput = {
    current: 'Youkan',
    conflict: false,
    availableAt: null,
    value: 'Youkan',
    availability: { state: 'empty' },
    now,
};

describe('checkDisplayName', () => {
    it('変えていなければ保存の対象にしない（前後の空白だけの違いも）', () => {
        expect(checkDisplayName({ ...base, value: '  Youkan ' })).toEqual({ kind: 'unchanged' });
    });

    it('別の名前は、サーバーで空きを確かめるまで保存させない', () => {
        expect(checkDisplayName({ ...base, value: 'Mochi', availability: { state: 'checking' } }).kind).toBe(
            'checking',
        );
        expect(checkDisplayName({ ...base, value: 'Mochi', availability: { state: 'available' } }).kind).toBe('ok');
        expect(
            checkDisplayName({ ...base, value: 'Mochi', availability: { state: 'taken', error: '使用されています' } }),
        ).toEqual({ kind: 'error', message: '使用されています' });
        expect(checkDisplayName({ ...base, value: '   ', availability: { state: 'empty' } }).kind).toBe('error');
    });

    it('期間中は別の名前に変えられないが、見た目だけの変更（大文字小文字・全角半角）はできる', () => {
        const cooling = { ...base, availableAt: '2026-12-01T00:00:00Z' };
        expect(checkDisplayName({ ...cooling, value: 'Mochi', availability: { state: 'available' } })).toEqual({
            kind: 'cooldown',
            availableAt: new Date('2026-12-01T00:00:00Z'),
        });
        expect(checkDisplayName({ ...cooling, value: 'ｙｏｕｋａｎ', availability: { state: 'available' } }).kind).toBe(
            'ok',
        );
        expect(
            checkDisplayName({
                ...cooling,
                availableAt: '2026-10-01T00:00:00Z',
                value: 'Mochi',
                availability: { state: 'available' },
            }).kind,
        ).toBe('ok');
    });

    it('他人と重複していた名前は、期間に関係なく直せる', () => {
        expect(
            checkDisplayName({
                ...base,
                conflict: true,
                availableAt: '2026-12-01T00:00:00Z',
                value: 'Mochi',
                availability: { state: 'available' },
            }).kind,
        ).toBe('ok');
    });

    it('保存してよいのは変えていないか、確かめ終わったときだけ', () => {
        expect(canSaveDisplayName({ kind: 'unchanged' })).toBe(true);
        expect(canSaveDisplayName({ kind: 'ok' })).toBe(true);
        expect(canSaveDisplayName({ kind: 'checking' })).toBe(false);
        expect(canSaveDisplayName({ kind: 'cooldown', availableAt: now })).toBe(false);
        expect(canSaveDisplayName({ kind: 'error', message: 'x' })).toBe(false);
    });
});
