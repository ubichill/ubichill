import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sriOf } from './integrity';

describe('sriOf（lock integrity 生成）', () => {
    it('sha256-<base64> 形式を返す', async () => {
        const bytes = new TextEncoder().encode('hello').buffer;
        expect(await sriOf(bytes)).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
    });

    it('build-workers 側（Buffer の sha256 base64）と同一バイト列で一致する', async () => {
        const code = 'const x = "日本語も含む";';
        const bytes = new TextEncoder().encode(code);
        const expected = `sha256-${createHash('sha256').update(Buffer.from(bytes)).digest('base64')}`;
        expect(await sriOf(bytes.buffer)).toBe(expected);
    });

    it('1 バイトの差分で integrity が変わる（差し替え検知）', async () => {
        const a = await sriOf(new TextEncoder().encode('abc').buffer);
        const b = await sriOf(new TextEncoder().encode('abd').buffer);
        expect(a).not.toBe(b);
    });
});
