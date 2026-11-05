import { describe, expect, it } from 'vitest';
import { contentTypeOf, DEV_META, matchRoute, withDevMeta } from './routes.ts';

describe('matchRoute', () => {
    it('dev の API・世代の URL・Go への中継・静的ファイル・ページを分ける', () => {
        expect(matchRoute('GET', '/__ubichill/events')).toEqual({ kind: 'events' });
        expect(matchRoute('POST', '/__ubichill/reconfigure')).toEqual({ kind: 'reconfigure' });
        expect(matchRoute('GET', '/__ubichill/g/ab12-3/lock.json')).toEqual({ kind: 'lock', buildId: 'ab12-3' });
        expect(matchRoute('GET', '/__ubichill/g/ab12-3/mods/pen/v2.0.0/pen/index.1a2b3c4d.js')).toEqual({
            kind: 'mod-file',
            buildId: 'ab12-3',
            modId: 'pen',
            version: '2.0.0',
            file: 'pen/index.1a2b3c4d.js',
        });
        expect(matchRoute('GET', '/__ubichill/g/x/mods/wasm-demo/v1.0.0-beta.1/manifest.json')).toMatchObject({
            kind: 'mod-file',
            version: '1.0.0-beta.1',
            file: 'manifest.json',
        });
        expect(matchRoute('GET', '/realtime/v1/instances/default/guest')).toEqual({ kind: 'realtime' });
        expect(matchRoute('GET', '/assets/world-abc.js')).toEqual({ kind: 'asset', file: 'assets/world-abc.js' });
        expect(matchRoute('GET', '/icon.png')).toEqual({ kind: 'asset', file: 'icon.png' });
        expect(matchRoute('GET', '/')).toEqual({ kind: 'page' });
        expect(matchRoute('GET', '/room-1')).toEqual({ kind: 'page' });
        expect(matchRoute('GET', '/world.html')).toEqual({ kind: 'page' });
    });

    it('辿り上がり・不正な要素・違うメソッドは 404', () => {
        for (const path of [
            '/__ubichill/g/../lock.json',
            '/__ubichill/g/x/mods/pen/v1.0.0/../../../secret',
            '/__ubichill/g/x/mods/pen/v1.0.0/%2e%2e/secret',
            '/__ubichill/g/x/mods/Pen/v1.0.0/manifest.json',
            '/__ubichill/g/x/mods/pen/1.0.0/manifest.json',
            '/__ubichill/g/x/mods/pen/v1.0.0/',
            '/__ubichill/g/x/mods/pen/v1.0.0/a%00b',
            '/__ubichill/g/x%2Fy/lock.json',
            '/__ubichill/unknown',
            '/assets/../package.json',
            '/assets/%2e%2e/package.json',
        ]) {
            expect(matchRoute('GET', path), path).toEqual({ kind: 'not-found' });
        }
        expect(matchRoute('POST', '/__ubichill/events')).toEqual({ kind: 'not-found' });
        expect(matchRoute('GET', '/__ubichill/reconfigure')).toEqual({ kind: 'not-found' });
        expect(matchRoute('POST', '/room')).toEqual({ kind: 'not-found' });
        expect(matchRoute('PUT', '/__ubichill/g/x/lock.json')).toEqual({ kind: 'not-found' });
    });

    it('/realtime/v1/ だけを Go へ渡す（/realtime/v2 や /api は渡さない）', () => {
        expect(matchRoute('GET', '/realtime/v2/x').kind).toBe('page');
        expect(matchRoute('GET', '/api/v1/instances').kind).toBe('page');
        expect(matchRoute('POST', '/api/v1/instances').kind).toBe('not-found');
    });
});

describe('contentTypeOf / withDevMeta', () => {
    it('拡張子から Content-Type を決める', () => {
        expect(contentTypeOf('a/index.1a2b3c4d.js')).toBe('text/javascript; charset=utf-8');
        expect(contentTypeOf('manifest.json')).toBe('application/json; charset=utf-8');
        expect(contentTypeOf('x.wasm')).toBe('application/wasm');
        expect(contentTypeOf('x.unknownext')).toBe('application/octet-stream');
    });
    it('world.html の head に dev の印を 1 回だけ入れる', () => {
        const once = withDevMeta('<html><head><title>x</title></head></html>');
        expect(once).toContain(DEV_META);
        expect(withDevMeta(once).split(DEV_META)).toHaveLength(2);
    });
});
