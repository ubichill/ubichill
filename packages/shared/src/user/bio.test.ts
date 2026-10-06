import { describe, expect, it } from 'vitest';
import { BIO_MAX_LENGTH, BioSchema, bioLength } from './handle';

describe('BioSchema', () => {
    it('前後の空白を除き、空なら null（書いていない）', () => {
        expect(BioSchema.parse('  よろしく  ')).toBe('よろしく');
        expect(BioSchema.parse('   \n ')).toBeNull();
    });

    it('改行は使える（CRLF は LF にそろえる）', () => {
        expect(BioSchema.parse('一行目\r\n二行目')).toBe('一行目\n二行目');
    });

    it('上限は文字数（絵文字などのサロゲートペアも 1 文字）', () => {
        expect(BioSchema.safeParse('あ'.repeat(BIO_MAX_LENGTH)).success).toBe(true);
        expect(BioSchema.safeParse('あ'.repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
        expect(BioSchema.safeParse('𠮷'.repeat(BIO_MAX_LENGTH)).success).toBe(true);
        expect(BioSchema.safeParse('𠮷'.repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
    });

    it('上限は保存される形で数える（前後の空白・CRLF で入力が長くても、正規化後に収まれば通る）', () => {
        const padded = `${' '.repeat(200)}${'𠮷'.repeat(BIO_MAX_LENGTH)}${'\r\n'.repeat(200)}`;
        expect(bioLength(padded)).toBe(BIO_MAX_LENGTH);
        expect(BioSchema.parse(padded)).toBe('𠮷'.repeat(BIO_MAX_LENGTH));
        const crlf = 'a\r\n'.repeat(150).trim();
        expect(bioLength(crlf)).toBe(299);
        expect(BioSchema.safeParse(crlf).success).toBe(true);
    });

    it('画面の文字数と API の判定がずれない', () => {
        for (const v of ['𠮷'.repeat(BIO_MAX_LENGTH + 1), ` ${'あ'.repeat(BIO_MAX_LENGTH)} `, 'x\r\n'.repeat(160)]) {
            expect(BioSchema.safeParse(v).success).toBe(bioLength(v) <= BIO_MAX_LENGTH);
        }
    });

    it('改行・タブ以外の制御文字は使えない', () => {
        expect(BioSchema.safeParse('a\u0000b').success).toBe(false);
        expect(BioSchema.safeParse('a\tb').success).toBe(true);
    });
});
