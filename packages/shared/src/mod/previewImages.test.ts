import { describe, expect, it } from 'vitest';
import { MAX_PREVIEW_IMAGE_BYTES, previewImageProblems, previewImageRefs, previewImageType } from './previewImages';

describe('previewImageType', () => {
    it('画像の拡張子だけ MIME を返す（大文字も可）', () => {
        expect(previewImageType('previews/pen.svg')).toBe('image/svg+xml');
        expect(previewImageType('a/B.PNG')).toBe('image/png');
        expect(previewImageType('x.jpeg')).toBe('image/jpeg');
    });

    it('画像でないもの・拡張子の無いものは null', () => {
        expect(previewImageType('previews/pen.html')).toBeNull();
        expect(previewImageType('previews/pen')).toBeNull();
        expect(previewImageType('previews/svg')).toBeNull();
        expect(previewImageType('gif.gif')).toBeNull();
    });
});

describe('previewImageRefs', () => {
    it('mod・Component・プレハブの画像の参照先を集め、無いものは含めない', () => {
        expect(
            previewImageRefs({
                thumbnail: 'previews/thumbnail.svg',
                components: { 'pen:pen': { thumbnail: 'previews/pen.svg' }, 'pen:stroke': {} },
                prefabs: { 'pen-set': { thumbnail: 'previews/pen-set.svg' } },
            }),
        ).toEqual({
            thumbnail: 'previews/thumbnail.svg',
            components: { 'pen:pen': 'previews/pen.svg' },
            prefabs: { 'pen-set': 'previews/pen-set.svg' },
        });
    });

    it('画像の無い manifest は空', () => {
        expect(previewImageRefs({ components: {} })).toEqual({ components: {}, prefabs: {} });
    });
});

describe('previewImageProblems', () => {
    const refs = {
        thumbnail: 'previews/thumbnail.svg',
        components: { 'pen:pen': 'previews/pen.png' },
        prefabs: { 'pen-set': 'previews/pen-set.webp' },
    };

    it('assets にある上限以下の画像なら問題なし', () => {
        expect(
            previewImageProblems(refs, {
                'previews/thumbnail.svg': 100,
                'previews/pen.png': MAX_PREVIEW_IMAGE_BYTES,
                'previews/pen-set.webp': 1,
            }),
        ).toEqual([]);
    });

    it('assets に無い・画像でない・大きすぎる画像をそれぞれ知らせる', () => {
        const problems = previewImageProblems(
            {
                thumbnail: 'previews/missing.svg',
                components: { 'pen:pen': 'run.js' },
                prefabs: { 'pen-set': 'big.png' },
            },
            { 'run.js': 10, 'big.png': MAX_PREVIEW_IMAGE_BYTES + 1 },
        );
        expect(problems).toHaveLength(3);
        expect(problems[0]).toContain('mod のサムネイル');
        expect(problems[1]).toContain('Component pen:pen');
        expect(problems[2]).toContain('プレハブ pen-set');
    });
});
