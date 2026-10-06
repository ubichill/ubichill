import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ API_BASE: '' }));

import { isJoinRejection } from './instanceConnection';

describe('isJoinRejection', () => {
    it.each([401, 403, 404, 410, 422])('%i は再試行しても変わらない拒否', (status) => {
        expect(isJoinRejection(status)).toBe(true);
    });
    it.each([408, 429, 500, 502, 503, 504])('%i は一時的な失敗として再接続に任せる', (status) => {
        expect(isJoinRejection(status)).toBe(false);
    });
    it('成功やリダイレクトを拒否と誤認しない', () => {
        expect(isJoinRejection(200)).toBe(false);
        expect(isJoinRejection(302)).toBe(false);
    });
});
