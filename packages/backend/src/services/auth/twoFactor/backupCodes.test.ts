import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BACKUP_CODE_COUNT, newBackupCode, newBackupCodes, normalizeBackupCode } from './backupCodes';

describe('バックアップコード', () => {
    it('10 文字を 5 文字ずつに分けて出し、見間違えやすい i・l・o・u は使わない', () => {
        const codes = newBackupCodes((n) => new Uint8Array(randomBytes(n)));
        expect(codes).toHaveLength(BACKUP_CODE_COUNT);
        expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
        for (const code of codes) expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
    });

    it('どのバイトも文字に割り当てる（端の値で範囲を外れない）', () => {
        expect(newBackupCode((n) => new Uint8Array(n).fill(255))).toBe('zzzzz-zzzzz');
        expect(newBackupCode((n) => new Uint8Array(n).fill(0))).toBe('00000-00000');
        expect(newBackupCode((n) => new Uint8Array(n).fill(32))).toBe('00000-00000');
    });

    it('入力は大文字・空白・ハイフンを許し、i・l を 1、o を 0 と読む', () => {
        expect(normalizeBackupCode('ABCDE-FGH12')).toBe('abcdefgh12');
        expect(normalizeBackupCode(' abcde fgh12 ')).toBe('abcdefgh12');
        expect(normalizeBackupCode('abcdefghIL')).toBe('abcdefgh11');
        expect(normalizeBackupCode('Oo000-00000')).toBe('0000000000');
        // 作ったコードは、そのまま入れても読み替えた形と同じ
        const code = newBackupCode((n) => new Uint8Array(randomBytes(n)));
        expect(normalizeBackupCode(code)).toBe(code.replace('-', ''));
    });

    it('長さ・文字が違えば受け付けない（認証アプリの 6 桁とも重ならない）', () => {
        for (const input of [
            '',
            '123456',
            'abcde-fgh1',
            'abcde-fgh123',
            'abcde-fghu1',
            'abcde_fgh12',
            'ａｂｃｄｅ-fgh12',
        ]) {
            expect(normalizeBackupCode(input)).toBeNull();
        }
    });
});
