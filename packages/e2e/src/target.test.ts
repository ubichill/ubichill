import { describe, expect, it } from 'vitest';
import { resolveTarget, socketUrl } from './target.ts';

describe('resolveTarget', () => {
    it('プレビューは画面と API が同じオリジン（パス・末尾の / は捨てる）', () => {
        expect(resolveTarget('https://pr-12.ubichill.com/some/path/')).toEqual({
            origin: 'https://pr-12.ubichill.com',
            apiOrigin: 'https://pr-12.ubichill.com',
        });
    });

    it('localhost の画面は :3001 の API を呼ぶ（frontend の lib/api.ts と同じ）', () => {
        expect(resolveTarget('http://localhost:3000')).toEqual({
            origin: 'http://localhost:3000',
            apiOrigin: 'http://localhost:3001',
        });
    });

    it('API の URL を渡せばそちらを使う', () => {
        expect(resolveTarget('http://localhost:3200', 'http://localhost:3201/api')).toEqual({
            origin: 'http://localhost:3200',
            apiOrigin: 'http://localhost:3201',
        });
    });

    it.each(['https://ubichill.com', 'https://www.ubichill.com/', 'https://UBICHILL.com'])(
        '本番（%s）には走らせない',
        (url) => {
            expect(() => resolveTarget(url)).toThrow(/本番/);
        },
    );

    it('API に本番を渡しても断る', () => {
        expect(() => resolveTarget('http://localhost:3000', 'https://ubichill.com')).toThrow(/本番/);
    });

    it('本番に似た別のホストは断らない', () => {
        expect(resolveTarget('https://ubichill.com.example.org').origin).toBe('https://ubichill.com.example.org');
    });

    it.each([undefined, '', 'pr-12.ubichill.com', 'ftp://example.com'])('URL でないもの（%s）は断る', (raw) => {
        expect(() => resolveTarget(raw)).toThrow();
    });
});

describe('socketUrl', () => {
    it('相対の url はオリジンに付け、https は wss にする（クエリは残す）', () => {
        expect(socketUrl('https://pr-1.ubichill.com', '/realtime/v1/ws?x=1')).toBe(
            'wss://pr-1.ubichill.com/realtime/v1/ws?x=1',
        );
    });

    it('絶対の http の url（ローカルの INSTANCE_PUBLIC_URL）は ws にする', () => {
        expect(socketUrl('http://localhost:3001', 'http://localhost:3002/realtime/v1/ws')).toBe(
            'ws://localhost:3002/realtime/v1/ws',
        );
    });

    it('最初から ws(s) ならそのまま', () => {
        expect(socketUrl('http://localhost:3001', 'wss://rt.example.com/ws')).toBe('wss://rt.example.com/ws');
    });

    it('WebSocket にできない url は断る', () => {
        expect(() => socketUrl('http://localhost:3001', 'ftp://example.com/ws')).toThrow();
    });
});
