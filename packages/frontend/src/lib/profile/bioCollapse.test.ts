import { describe, expect, it } from 'vitest';
import { BIO_COLLAPSE, shouldCollapseBio } from './bioCollapse';

const { maxLines, maxChars, minHiddenChars } = BIO_COLLAPSE;

describe('shouldCollapseBio', () => {
    it('短い自己紹介・空は折りたたまない', () => {
        expect(shouldCollapseBio('よろしく')).toBe(false);
        expect(shouldCollapseBio('')).toBe(false);
        expect(shouldCollapseBio('   \n\n  ')).toBe(false);
    });

    it('行数が目安を超えたら折りたたむ（ちょうどは折りたたまない）', () => {
        expect(shouldCollapseBio(Array.from({ length: maxLines }, () => 'a').join('\n'))).toBe(false);
        expect(shouldCollapseBio(Array.from({ length: maxLines + 1 }, () => 'a').join('\n'))).toBe(true);
    });

    it('CRLF・前後の空行は行に数えない', () => {
        const text = `\r\n\r\n${Array.from({ length: maxLines }, () => 'a').join('\r\n')}\r\n\r\n`;
        expect(shouldCollapseBio(text)).toBe(false);
    });

    it('文字数は目安を少し超える程度なら全部見せ、隠れる分が長ければ折りたたむ', () => {
        expect(shouldCollapseBio('あ'.repeat(maxChars + minHiddenChars))).toBe(false);
        expect(shouldCollapseBio('あ'.repeat(maxChars + minHiddenChars + 1))).toBe(true);
    });

    it('文字数はコードポイントで数える（サロゲートペアで早く折りたたまない）', () => {
        expect(shouldCollapseBio('𠮷'.repeat(maxChars + minHiddenChars))).toBe(false);
    });

    it('改行だけで水増しした文字数は数えない', () => {
        expect(shouldCollapseBio(`${'a'.repeat(maxChars)}\n${'b'.repeat(minHiddenChars)}`)).toBe(false);
    });
});
