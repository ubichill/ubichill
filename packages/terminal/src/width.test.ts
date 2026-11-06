import { describe, expect, it } from 'vitest';
import { ansiPaint } from './paint.ts';
import { displayWidth, padDisplay } from './width.ts';

describe('displayWidth', () => {
    it('ASCII は 1 桁、日本語（ひらがな・漢字・全角記号）は 2 桁', () => {
        expect(displayWidth('Local:')).toBe(6);
        expect(displayWidth('ワールド')).toBe(8);
        expect(displayWidth('世代（4a3f）')).toBe(4 + 4 + 4);
    });

    it('色の符号は幅に数えない', () => {
        expect(displayWidth(ansiPaint(['cyan', 'bold'], 'abc'))).toBe(3);
    });

    it('結合文字・ゼロ幅の文字・制御文字は 0 桁', () => {
        expect(displayWidth('é')).toBe(1);
        expect(displayWidth('a​b')).toBe(2);
        expect(displayWidth('a\tb')).toBe(2);
    });

    it('記号（✓ ✗ ➜）は 1 桁（Ambiguous ではない）', () => {
        expect(displayWidth('✓✗➜')).toBe(3);
    });
});

describe('padDisplay', () => {
    it('全角を 2 桁と数えて埋める', () => {
        expect(padDisplay('世界:', 8)).toBe('世界:   ');
    });

    it('既に長ければ切らずにそのまま返す', () => {
        expect(padDisplay('とても長いラベル', 4)).toBe('とても長いラベル');
    });
});
