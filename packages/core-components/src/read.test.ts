import { describe, expect, it } from 'vitest';
import { ColliderDataSchema } from './collider/schema.js';
import { readCoreComponentData, unknownCoreComponentKeys, validateCoreComponentData } from './index.js';
import { readCoreData, unknownKeysOf } from './read.js';
import { TextDataSchema } from './text/schema.js';

describe('readCoreData（読む側）', () => {
    it('知らない項目を捨てて読む。元の data は書き換えない', () => {
        const data = { text: 'ようこそ', glow: true };
        const result = readCoreData(TextDataSchema, data);
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ text: 'ようこそ' });
        expect(result.data).not.toHaveProperty('glow');
        expect(data).toEqual({ text: 'ようこそ', glow: true });
    });

    it('入れ子と、判別付きの union の中の知らない項目も捨てる', () => {
        const result = readCoreData(ColliderDataSchema, {
            shape: 'rect',
            size: { w: 10, h: 20, d: 5 },
            offset: { x: 1, y: 2, z: 3 },
            bounce: 0.5,
        });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ shape: 'rect', size: { w: 10, h: 20 }, offset: { x: 1, y: 2 } });
        expect(result.data).not.toHaveProperty('bounce');
        expect(result.data?.offset).not.toHaveProperty('z');
    });

    it('値の誤りは断る。知らない項目と一緒でも、残るのは値の誤りだけ', () => {
        const result = readCoreData(TextDataSchema, { text: 'a', size: 9999, glow: true });
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((issue) => issue.code)).not.toContain('unrecognized_keys');
        expect(result.error?.issues.map((issue) => issue.path)).toEqual([['size']]);
    });

    it('知らない項目の名前が既知の項目と重なっても、既知の項目は消さない', () => {
        const result = readCoreData(ColliderDataSchema, {
            shape: 'circle',
            radius: 4,
            offset: { x: 0, y: 0, shape: 'x' },
        });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ shape: 'circle', radius: 4, offset: { x: 0, y: 0 } });
    });

    it('オブジェクトでない data は、そのまま断る', () => {
        expect(readCoreData(TextDataSchema, 'text').success).toBe(false);
        expect(readCoreData(TextDataSchema, null).success).toBe(false);
        expect(readCoreData(TextDataSchema, [{ text: 'a' }]).success).toBe(false);
    });
});

describe('unknownKeysOf（書く側）', () => {
    it('知らない項目の場所を . でつないで返す', () => {
        expect(
            unknownKeysOf(ColliderDataSchema, {
                shape: 'rect',
                size: 'entity',
                offset: { x: 0, y: 0, z: 1 },
                bounce: 1,
            }),
        ).toEqual(expect.arrayContaining(['bounce', 'offset.z']));
    });

    it('知らない項目が無ければ空（値の誤りは数えない）', () => {
        expect(unknownKeysOf(TextDataSchema, { text: 'a' })).toEqual([]);
        expect(unknownKeysOf(TextDataSchema, { text: 'a', size: -1 })).toEqual([]);
    });
});

describe('型ごとの読み書き', () => {
    it('書く側は知らない項目を断り、読む側は通す', () => {
        const data = { src: '', fit: 'cover', caption: '新しい項目' };
        expect(validateCoreComponentData('core:image', data).success).toBe(false);
        expect(readCoreComponentData('core:image', data).success).toBe(true);
        expect(unknownCoreComponentKeys('core:image', data)).toEqual(['caption']);
    });

    it('core:media の再生の中身（url）も、読む側では捨てるだけで使わない', () => {
        const result = readCoreComponentData('core:media', { fit: 'cover', url: 'https://example.com/a.mp4' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ fit: 'cover' });
    });
});
