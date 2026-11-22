import { describe, expect, it } from 'vitest';
import { portalRoomPath } from './portalPath';

describe('portalRoomPath', () => {
    it('部屋の ID も、ほかのサーバーの部屋の住所も 1 つのパスにする', () => {
        expect(portalRoomPath('V1StGXR8_Z5jdHi6B-myT')).toBe('/instance/V1StGXR8_Z5jdHi6B-myT');
        expect(portalRoomPath('abc@room.example:8443')).toBe(
            `/instance/${encodeURIComponent('abc@room.example:8443')}`,
        );
        expect(portalRoomPath('../admin')).toBe(`/instance/${encodeURIComponent('../admin')}`);
    });
});
