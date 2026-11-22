import { describe, expect, it } from 'vitest';
import { WORLD_ASSET_REFERENCE_PATTERN, worldAssetHashOf, worldAssetPath } from './assets';

const referencedHashes = (text: string) =>
    [...text.matchAll(new RegExp(WORLD_ASSET_REFERENCE_PATTERN, 'g'))].map((match) => match[1]);

// base64url の記号（- と _）を含み、前後に英数字が続く
const HASH = 'Ab-_0123456789abcdefghijklmnopqrstuvwxyzABC';

describe('WORLD_ASSET_REFERENCE_PATTERN', () => {
    it('配信する URL の形から、ハッシュをそのまま取り出す（掃除が使われている画像を消さない）', () => {
        expect(HASH).toHaveLength(43);
        const file = worldAssetPath(HASH).split('/').at(-1) ?? '';
        expect(worldAssetHashOf(file)).toBe(HASH);
        for (const url of [
            `https://ubi.example${worldAssetPath(HASH)}`,
            worldAssetPath(HASH),
            `https://other.example${worldAssetPath(HASH)}?v=2`,
            `https://proxy.example/?u=${encodeURIComponent(`https://ubi.example${worldAssetPath(HASH)}`)}`,
        ]) {
            expect(referencedHashes(url)).toEqual([HASH]);
        }
    });

    it('定義の JSON の中から全部拾う（同じ文字列に 2 つ並んでも）', () => {
        const other = HASH.split('').reverse().join('');
        const definition = JSON.stringify({
            metadata: { thumbnail: `https://ubi.example${worldAssetPath(HASH)}` },
            entities: [{ components: [{ data: { text: `${worldAssetPath(HASH)}${worldAssetPath(other)}` } }] }],
        });
        expect(referencedHashes(definition)).toEqual([HASH, HASH, other]);
    });

    it('.webp が続かないハッシュは画像を指していない（その URL では配れない）', () => {
        expect(referencedHashes(`/api/v1/assets/${HASH}`)).toEqual([]);
        expect(referencedHashes(`${HASH}.png`)).toEqual([]);
        expect(referencedHashes(`${HASH.slice(1)}.webp`)).toEqual([]);
    });
});
