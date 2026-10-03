import { describe, expect, it } from 'vitest';
import { instanceWorldRef, localWorldPagePath } from './worldRef';

describe('instanceWorldRef', () => {
    it('外部ワールドは取得元の URL（id だけでは自サーバーで解決できない）', () => {
        const url = 'https://raw.githubusercontent.com/ieyoukan/ubichill-worlds/main/worlds/chillwa.yaml';
        expect(instanceWorldRef({ id: 'chillwa', source: { kind: 'url', url } })).toBe(url);
    });

    it('取得元が無ければ id', () => {
        expect(instanceWorldRef({ id: 'default' })).toBe('default');
    });
});

describe('localWorldPagePath', () => {
    it('正規 URL から共有ページのパス（/@handle/name）を作る（API とフロントのオリジンが違っても）', () => {
        expect(
            localWorldPagePath({ id: 'x7k2', url: 'http://localhost:3001/api/v1/authors/youkan/worlds/my-world.yaml' }),
        ).toBe('/@youkan/my-world');
    });

    it('作れなければ以前の形（/world/:id）', () => {
        expect(localWorldPagePath({ id: 'x7k2' })).toBe('/world/x7k2');
        expect(localWorldPagePath({ id: 'x7k2', url: 'https://h/api/v1/worlds/x7k2' })).toBe('/world/x7k2');
    });
});
