import { sriOf } from '@ubichill/loader';
import { MAX_PREVIEW_IMAGE_BYTES } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { fetchVerifiedImage, previewImageSource } from './previewImage';

const base = 'https://cdn.example/mods/pen/v2.3.0';
const manifest = { assetIntegrity: { 'previews/pen.svg': 'sha256-pen', 'previews/run.js': 'sha256-js' } };

describe('previewImageSource', () => {
    it('assetIntegrity にある画像だけ、取得先と固定した hash を返す', () => {
        expect(previewImageSource(manifest, base, 'previews/pen.svg')).toEqual({
            url: `${base}/previews/pen.svg`,
            integrity: 'sha256-pen',
            type: 'image/svg+xml',
        });
    });

    it('固定されていない画像・画像でないもの・参照の無いものは出さない', () => {
        expect(previewImageSource(manifest, base, 'previews/other.svg')).toBeUndefined();
        expect(previewImageSource(manifest, base, 'previews/run.js')).toBeUndefined();
        expect(previewImageSource(manifest, base, undefined)).toBeUndefined();
        expect(previewImageSource({}, base, 'previews/pen.svg')).toBeUndefined();
    });

    it('package の外を指す参照は、assetIntegrity に載っていても出さない', () => {
        const tricky = { assetIntegrity: { '../x.svg': 'a', '/x.svg': 'b', 'a\\x.svg': 'c', 'a//x.svg': 'd' } };
        for (const path of Object.keys(tricky.assetIntegrity))
            expect(previewImageSource(tricky, base, path)).toBeUndefined();
    });

    it('パスの各部分を URL として正しく書く', () => {
        expect(
            previewImageSource({ assetIntegrity: { 'previews/ペン #1.png': 'x' } }, base, 'previews/ペン #1.png')?.url,
        ).toBe(`${base}/previews/${encodeURIComponent('ペン #1.png')}`);
    });
});

describe('fetchVerifiedImage', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const respond =
        (body: Uint8Array, status = 200) =>
        async () =>
            new Response(body.slice().buffer, { status });

    it('hash が一致すれば、形式を付けた画像を返す', async () => {
        const integrity = await sriOf(svg.slice().buffer);
        const blob = await fetchVerifiedImage({ url: 'u', integrity, type: 'image/svg+xml' }, respond(svg));
        expect(blob.type).toBe('image/svg+xml');
        expect(blob.size).toBe(svg.byteLength);
    });

    it('配布先で差し替えられた画像は拒否する', async () => {
        const integrity = await sriOf(svg.slice().buffer);
        const tampered = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>x</text></svg>');
        await expect(
            fetchVerifiedImage({ url: 'u', integrity, type: 'image/svg+xml' }, respond(tampered)),
        ).rejects.toThrow('一致しません');
    });

    it('大きすぎる画像・取得できない画像は失敗する', async () => {
        const big = new Uint8Array(MAX_PREVIEW_IMAGE_BYTES + 1);
        await expect(fetchVerifiedImage({ url: 'u', integrity: 'x', type: 'image/png' }, respond(big))).rejects.toThrow(
            '大きすぎます',
        );
        await expect(
            fetchVerifiedImage({ url: 'u', integrity: 'x', type: 'image/png' }, respond(new Uint8Array(), 404)),
        ).rejects.toThrow('404');
    });
});
