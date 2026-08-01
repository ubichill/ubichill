import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { detectCapabilities, sriOf } from './build-workers.mjs';

describe('detectCapabilities（Ubi API の静的検出）', () => {
    it('Ubi.fetch から net:fetch を検出する', () => {
        expect(detectCapabilities('const r = await Ubi.fetch("https://api.example.com");')).toContain('net:fetch');
    });

    it('Ubi.ui.render から ui:render を検出する', () => {
        expect(detectCapabilities('Ubi.ui.render(() => <div/>);')).toContain('ui:render');
    });

    it('.showToast( から ui:toast を検出する', () => {
        expect(detectCapabilities('Ubi.ui.showToast("hi");')).toContain('ui:toast');
    });

    it('Ubi.entity / Ubi.state から scene:read と scene:update を検出する（over-approx）', () => {
        const caps = detectCapabilities('const e = Ubi.entity.self; Ubi.state.sync({});');
        expect(caps).toContain('scene:read');
        expect(caps).toContain('scene:update');
    });

    it('.broadcast( から event:broadcast、.sendToHost( から host:message を検出する', () => {
        const caps = detectCapabilities('Ubi.event.broadcast("x", {}); Ubi.event.sendToHost("user:update", {});');
        expect(caps).toContain('event:broadcast');
        expect(caps).toContain('host:message');
        expect(caps).toContain('event:emit');
    });

    it('Ubi.canvas → canvas:draw、Ubi.media → media:control', () => {
        expect(detectCapabilities('Ubi.canvas.frame();')).toContain('canvas:draw');
        expect(detectCapabilities('Ubi.media.play("t");')).toContain('media:control');
    });

    it('Ubi API を使わないコードは空配列を返す', () => {
        expect(detectCapabilities('const x = 1 + 2; console.log(x);')).toEqual([]);
    });

    it('emit だけのmodは host-message / broadcast を申告しない（過剰にならない）', () => {
        const caps = detectCapabilities('Ubi.event.emit("tick", {});');
        expect(caps).toContain('event:emit');
        expect(caps).not.toContain('event:broadcast');
        expect(caps).not.toContain('host:message');
    });

    it('結果はソート済み・重複なし', () => {
        const caps = detectCapabilities('Ubi.entity.self; Ubi.entity.query(); Ubi.ui.render();');
        expect(caps).toEqual([...new Set(caps)].sort());
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
