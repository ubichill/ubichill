import { describe, expect, it, vi } from 'vitest';
import { authorizeExternalUrl } from './useExternalUrlAuthorization';

const base = {
    modBase: 'https://mods.example.com/sample/v1/',
    modId: 'sample',
    appOrigin: 'https://ubichill.example.com',
};

describe('authorizeExternalUrl', () => {
    it('外部URLはfetch・メディア共通のドメイン認可へ渡す', async () => {
        const authorizeExternalDomain = vi.fn().mockResolvedValue(true);
        const result = await authorizeExternalUrl({
            ...base,
            url: 'https://media.example.com/video.mp4',
            authorizeExternalDomain,
        });

        expect(authorizeExternalDomain).toHaveBeenCalledWith('sample', 'media.example.com');
        expect(result).toEqual({ allowed: true, url: 'https://media.example.com/video.mp4' });
    });

    it('同じmodの配布領域は追加確認なしで許可する', async () => {
        const authorizeExternalDomain = vi.fn();
        const result = await authorizeExternalUrl({
            ...base,
            url: './assets/video.mp4',
            authorizeExternalDomain,
        });

        expect(authorizeExternalDomain).not.toHaveBeenCalled();
        expect(result).toEqual({ allowed: true, url: 'https://mods.example.com/sample/v1/assets/video.mp4' });
    });

    it('HTTPは確認を出す前に拒否する', async () => {
        const authorizeExternalDomain = vi.fn();
        const result = await authorizeExternalUrl({
            ...base,
            url: 'http://media.example.com/video.mp4',
            authorizeExternalDomain,
        });

        expect(authorizeExternalDomain).not.toHaveBeenCalled();
        expect(result).toMatchObject({ allowed: false, code: 'FETCH_HTTPS_REQUIRED' });
    });

    it('拒否したドメインのURLを通さない', async () => {
        const result = await authorizeExternalUrl({
            ...base,
            url: 'https://blocked.example.com/video.mp4',
            authorizeExternalDomain: () => false,
        });

        expect(result).toMatchObject({
            allowed: false,
            code: 'FETCH_DOMAIN_NOT_ALLOWED',
            domain: 'blocked.example.com',
        });
    });

    it('アプリ本体のmod領域外へはアクセスさせない', async () => {
        const result = await authorizeExternalUrl({
            ...base,
            url: 'https://ubichill.example.com/api/v1/users',
            authorizeExternalDomain: () => true,
        });

        expect(result).toMatchObject({ allowed: false, code: 'FETCH_DOMAIN_NOT_ALLOWED' });
    });
});
