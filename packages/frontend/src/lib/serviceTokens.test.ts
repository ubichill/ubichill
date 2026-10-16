import { UbiErrorCode } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ API_BASE: 'https://ubichill.example' }));

import { serviceTokenErrorOf } from './serviceTokens';

describe('serviceTokenErrorOf', () => {
    it('宛先の誤りだけを IDENTITY_AUDIENCE_INVALID にする', () => {
        expect(serviceTokenErrorOf(400, 'audience-invalid').code).toBe(UbiErrorCode.IDENTITY_AUDIENCE_INVALID);
    });

    it.each([
        [400, 'mod-mismatch'],
        [400, 'invalid-request'],
        [400, undefined],
        [403, 'author-unconfirmed'],
        [403, 'signature-content-mismatch'],
    ])('作者署名・依頼の形の失敗（%i %s）は、宛先を直すよう案内しない', (status, code) => {
        const error = serviceTokenErrorOf(status, code);
        expect(error.code).toBe(UbiErrorCode.IDENTITY_UNAVAILABLE);
        expect(error.message).not.toContain('宛先');
    });

    it('作者をいま確認できない・発行していない・未ログインを分けて案内する', () => {
        const messages = [
            serviceTokenErrorOf(503, 'author-pending'),
            serviceTokenErrorOf(503, undefined),
            serviceTokenErrorOf(401, undefined),
            serviceTokenErrorOf(500, undefined),
        ].map((e) => e.message);
        expect(new Set(messages).size).toBe(4);
    });
});
