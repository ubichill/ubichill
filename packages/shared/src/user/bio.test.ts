import { describe, expect, it } from 'vitest';
import { BIO_MAX_LENGTH, BioSchema } from './handle';

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
    });

    it('改行・タブ以外の制御文字は使えない', () => {
        expect(BioSchema.safeParse('a\u0000b').success).toBe(false);
        expect(BioSchema.safeParse('a\tb').success).toBe(true);
    });
});
