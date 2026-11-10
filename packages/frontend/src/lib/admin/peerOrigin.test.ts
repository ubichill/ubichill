import { describe, expect, it } from 'vitest';
import { peerOriginOf } from './peerOrigin';

describe('peerOriginOf', () => {
    it('ホスト名だけなら https のオリジンにする', () => {
        expect(peerOriginOf(' ubichill.com ')).toBe('https://ubichill.com');
    });

    it('ワールドの URL や末尾のスラッシュはオリジンにそろえる（同じサーバーを二重にフォローしない）', () => {
        expect(peerOriginOf('https://ubichill.com/')).toBe('https://ubichill.com');
        expect(peerOriginOf('https://ubichill.com/world/default')).toBe('https://ubichill.com');
        expect(peerOriginOf('https://UbiChill.com:443/api/v1/worlds/default.yaml')).toBe('https://ubichill.com');
        expect(peerOriginOf('http://localhost:3001')).toBe('http://localhost:3001');
    });

    it('http(s) でない・ホスト名として読めないものは受け付けない', () => {
        for (const bad of ['', '   ', 'javascript:alert(1)', 'ftp://ubichill.com', 'ubichill', 'https://']) {
            expect(peerOriginOf(bad)).toBeNull();
        }
    });
});
