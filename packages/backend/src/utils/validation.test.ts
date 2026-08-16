import { describe, expect, it } from 'vitest';
import { validateCursorPosition, validateUsername, validateUserStatus, validateWorldId } from './validation';

describe('validateUsername', () => {
    it('1文字以上を許可し、前後空白は trim される', () => {
        expect(validateUsername('  alice  ')).toEqual({ valid: true, data: 'alice' });
    });

    it('空文字は拒否する', () => {
        expect(validateUsername('').valid).toBe(false);
        expect(validateUsername('   ').valid).toBe(false);
    });

    it('50文字を超えると拒否する', () => {
        expect(validateUsername('a'.repeat(51)).valid).toBe(false);
    });
});

describe('validateWorldId', () => {
    it('英数字・ハイフン・アンダースコアを許可する', () => {
        expect(validateWorldId('my-world_01')).toEqual({ valid: true, data: 'my-world_01' });
    });

    it('空白や記号・パス区切りは拒否する', () => {
        expect(validateWorldId('my world').valid).toBe(false);
        expect(validateWorldId('my/world').valid).toBe(false);
        expect(validateWorldId('日本語').valid).toBe(false);
    });
});

describe('validateCursorPosition', () => {
    it('範囲内は許可する', () => {
        expect(validateCursorPosition({ x: 0, y: 100000 }).valid).toBe(true);
    });

    it('範囲外は拒否する', () => {
        expect(validateCursorPosition({ x: -10001, y: 0 }).valid).toBe(false);
        expect(validateCursorPosition({ x: 0, y: 100001 }).valid).toBe(false);
    });
});

describe('validateUserStatus', () => {
    // UserStatus 型（entities.ts）は 'dnd' を含む。schema と型は一致すべき。
    it.each(['online', 'busy', 'dnd', 'away', 'offline'])('%s を許可する', (status) => {
        expect(validateUserStatus(status)).toEqual({ valid: true, data: status });
    });

    it('未知のステータスは拒否する', () => {
        expect(validateUserStatus('sleeping').valid).toBe(false);
    });
});
