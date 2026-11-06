import { describe, expect, it } from 'vitest';
import { formatBanner, paintUrl } from './banner.ts';
import type { LineStyle } from './event.ts';
import { ansiPaint, plainPaint, stripAnsi } from './paint.ts';
import { UNICODE_SYMBOLS } from './symbols.ts';
import { displayWidth } from './width.ts';

const plain: LineStyle = { paint: plainPaint, symbols: UNICODE_SYMBOLS };

describe('formatBanner', () => {
    it('見出し・空行・ラベルを揃えた行の順（Vite と同じ位置に値を置く）', () => {
        const text = formatBanner(
            {
                title: 'ubichill dev',
                version: '1.0.2',
                readyMs: 812,
                rows: [
                    { label: 'Local', value: 'http://localhost:3333/', tone: 'url' },
                    { label: 'World', value: 'worlds/chillwa.yaml', note: '(mods 2, local 0)' },
                    { label: 'Debug', value: '--debug でログを詳しく', tone: 'dim' },
                ],
            },
            plain,
        );
        expect(text.split('\n')).toEqual([
            '',
            '  ubichill dev  v1.0.2  ready in 812 ms',
            '',
            '  ➜  Local:   http://localhost:3333/',
            '  ➜  World:   worlds/chillwa.yaml  (mods 2, local 0)',
            '  ➜  Debug:   --debug でログを詳しく',
            '',
        ]);
    });

    it('長い・日本語のラベルに合わせて全部の値を揃える', () => {
        const text = formatBanner(
            {
                title: 't',
                rows: [
                    { label: 'ワールドの場所', value: 'a' },
                    { label: 'Local', value: 'b' },
                ],
            },
            plain,
        );
        const [, , , first = '', second = ''] = text.split('\n');
        expect(displayWidth(first.slice(0, first.indexOf('a')))).toBe(
            displayWidth(second.slice(0, second.indexOf('b'))),
        );
        expect(first).toBe('  ➜  ワールドの場所: a');
    });

    it('版も時間も行も無ければ見出しだけ', () => {
        expect(formatBanner({ title: 'ubichill', rows: [] }, plain)).toBe('\n  ubichill\n');
    });

    it('色を除けば色なしと同じ', () => {
        const banner = {
            title: 'ubichill dev',
            readyMs: 1500,
            rows: [{ label: 'Local', value: 'http://[::1]:3333/', tone: 'url' as const }],
        };
        expect(stripAnsi(formatBanner(banner, { ...plain, paint: ansiPaint }))).toBe(formatBanner(banner, plain));
    });
});

describe('paintUrl', () => {
    it('ポートだけ太字にする（IPv6 の角括弧の中のコロンをポートと取り違えない）', () => {
        const bold = (port: string) => ansiPaint(['cyan', 'bold'], port);
        expect(paintUrl('http://localhost:3333/', ansiPaint)).toContain(bold('3333'));
        expect(paintUrl('http://[::1]:3333/', ansiPaint)).toBe(
            `${ansiPaint('cyan', 'http://[::1]:')}${bold('3333')}${ansiPaint('cyan', '/')}`,
        );
    });

    it('ポートの無い URL も塗るだけで壊さない', () => {
        expect(stripAnsi(paintUrl('https://ubichill.com/', ansiPaint))).toBe('https://ubichill.com/');
    });

    it('ポートの無い IPv6 の URL で、アドレスの数字をポートと取り違えない', () => {
        expect(paintUrl('http://[::1]/', ansiPaint)).not.toContain('\u001b[1m');
    });
});
