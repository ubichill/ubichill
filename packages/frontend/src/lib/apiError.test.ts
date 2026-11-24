import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorOf, isReauthRequired } from './apiError';

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiErrorOf', () => {
    it('本文の error を文言に、code を理由に持つ（Error として今までどおり扱える）', async () => {
        const error = await apiErrorOf(json(403, { error: 'もう一度本人確認をしてください', code: 'reauth-required' }));
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('もう一度本人確認をしてください');
        expect(error).toMatchObject({ status: 403, code: 'reauth-required' });
        expect(isReauthRequired(error)).toBe(true);
    });

    it('本文が読めない・形が違うときは HTTP の状態で、理由なし', async () => {
        expect(await apiErrorOf(new Response('<html>', { status: 502 }))).toMatchObject({
            message: 'HTTP 502',
            code: null,
        });
        expect(await apiErrorOf(json(400, { error: { nested: true }, code: 42 }))).toMatchObject({
            message: 'HTTP 400',
            code: null,
        });
    });

    it('ほかの理由・ただの Error は本人確認の要求とみなさない', () => {
        expect(isReauthRequired(new ApiError('x', 403, 'password-required'))).toBe(false);
        expect(isReauthRequired(new Error('reauth-required'))).toBe(false);
        // 認証の API の失敗（フェディバースの連携の開始）も理由のコードで見分ける
        expect(isReauthRequired(Object.assign(new Error('x'), { code: 'reauth-required' }))).toBe(true);
        expect(isReauthRequired(null)).toBe(false);
    });
});
