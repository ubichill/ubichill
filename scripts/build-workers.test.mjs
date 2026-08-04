import { createHash } from 'node:crypto';
import { detectCapabilities as sharedDetectCapabilities } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { detectCapabilities, sriOf } from './build-workers.mjs';

// capability 検出の詳細な振る舞いテストは shared 側（packages/shared/src/mod/capability.test.ts）
// に一本化した。ここでは build-workers.mjs の re-export が正しく shared の実体に繋がっている
// ことだけを確認する（重複テストによるメンテナンスコストを避ける）。
describe('detectCapabilities（shared からの re-export）', () => {
    it('build-workers.mjs の detectCapabilities は shared の実体そのもの', () => {
        expect(detectCapabilities).toBe(sharedDetectCapabilities);
    });

    it('実際に検出も機能する（smoke）', () => {
        expect(detectCapabilities('Ubi.fetch("https://x");')).toContain('net:fetch');
    });
});

describe('sriOf（lock integrity 生成）', () => {
    it('sha256-<base64> 形式を返す', () => {
        expect(sriOf('hello')).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
    });

    it('ロード側と同一バイト列の hash に一致する（utf-8, base64）', () => {
        const code = 'const x = "日本語も含む";';
        // フロントは fetch した生バイト列（utf-8）を crypto.subtle で hash する。
        // 同じバイト列を Buffer 経由で hash した値と一致しなければ照合が破綻する。
        const expected = `sha256-${createHash('sha256').update(Buffer.from(code, 'utf-8')).digest('base64')}`;
        expect(sriOf(code)).toBe(expected);
    });

    it('1 バイトの差分で integrity が変わる（差し替え検知）', () => {
        expect(sriOf('abc')).not.toBe(sriOf('abd'));
    });
});
