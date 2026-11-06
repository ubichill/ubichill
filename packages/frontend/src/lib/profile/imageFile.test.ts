import { PROFILE_IMAGE_MAX_BYTES } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { imageFileProblem } from './imageFile';

describe('imageFileProblem', () => {
    it('画像なら送る（中身の確認はサーバー）', () => {
        expect(imageFileProblem({ size: 1000, type: 'image/jpeg' })).toBeNull();
        expect(imageFileProblem({ size: PROFILE_IMAGE_MAX_BYTES, type: 'image/png' })).toBeNull();
    });

    it('画像でないもの・SVG・形式の分からないもの・空・大きすぎるものは送らない', () => {
        for (const file of [
            { size: 10, type: 'text/html' },
            { size: 10, type: 'image/svg+xml' },
            { size: 10, type: '' },
            { size: 0, type: 'image/png' },
            { size: PROFILE_IMAGE_MAX_BYTES + 1, type: 'image/png' },
        ]) {
            expect(imageFileProblem(file), JSON.stringify(file)).not.toBeNull();
        }
    });
});
