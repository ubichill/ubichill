import { describe, expect, it } from 'vitest';
import { detectCapabilities } from './build-workers.mjs';

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
