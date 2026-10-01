import { describe, expect, it } from 'vitest';
import { instanceWorldRef } from './worldRef';

describe('instanceWorldRef', () => {
    it('外部ワールドは取得元の URL（id だけでは自サーバーで解決できない）', () => {
        const url = 'https://raw.githubusercontent.com/iehanako/ubichill-worlds/main/worlds/chillwa.yaml';
        expect(instanceWorldRef({ id: 'chillwa', source: { kind: 'url', url } })).toBe(url);
    });

    it('取得元が無ければ id', () => {
        expect(instanceWorldRef({ id: 'default' })).toBe('default');
    });
});
