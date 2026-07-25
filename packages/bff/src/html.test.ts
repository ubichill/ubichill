import { describe, expect, it } from 'vitest';
import { esc, escJsonForScript } from './html';

describe('esc', () => {
    it('HTML 特殊文字（属性で危険なクォート含む）をすべてエスケープする', () => {
        expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('属性コンテキストでの break-out を防ぐ', () => {
        expect(esc('" onclick="alert(1)')).not.toContain('"');
        expect(esc("' onclick='alert(1)")).not.toContain("'");
    });
});

describe('escJsonForScript', () => {
    it('</script> ブレイクアウトを塞ぐ（< を \\u003c に）', () => {
        // JSON.stringify は / を素通しするため、素の埋め込みだと </script> が閉じてしまう
        const json = JSON.stringify({ name: '</script><script>alert(document.cookie)</script>' });
        const out = escJsonForScript(json);
        // `<` さえ潰せば閉じタグは成立しない（`>` はエスケープ不要）
        expect(out).not.toContain('</script>');
        expect(out).not.toContain('<script>');
        expect(out).toContain('\\u003c/script>');
        // JSON としては依然 valid（< は < にデコードされる）
        expect(JSON.parse(out).name).toBe('</script><script>alert(document.cookie)</script>');
    });

    it('U+2028 / U+2029 を JS 文字列で安全な形にエスケープする', () => {
        const json = JSON.stringify({ a: `x${String.fromCodePoint(0x2028)}y${String.fromCodePoint(0x2029)}z` });
        const out = escJsonForScript(json);
        expect(out).not.toContain(String.fromCodePoint(0x2028));
        expect(out).not.toContain(String.fromCodePoint(0x2029));
        expect(out).toContain('\\u2028');
        expect(out).toContain('\\u2029');
        expect(JSON.parse(out).a).toBe(`x${String.fromCodePoint(0x2028)}y${String.fromCodePoint(0x2029)}z`);
    });

    it('通常の JSON は壊さない', () => {
        const json = JSON.stringify({ name: 'ふつうのワールド', v: 1 });
        expect(JSON.parse(escJsonForScript(json))).toEqual({ name: 'ふつうのワールド', v: 1 });
    });
});
