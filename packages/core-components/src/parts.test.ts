import { describe, expect, it } from 'vitest';
import { CORE_COMPONENT_TYPES, isCoreComponentType, validateCoreComponentData } from './index.js';
import { parsePortalTarget } from './portal/schema.js';

describe('core:image', () => {
    it('空の data は空の画像（何も描かない）にする', () => {
        const result = validateCoreComponentData(CORE_COMPONENT_TYPES.image, {});
        expect(result.success && result.data).toEqual({ src: '', fit: 'contain', alt: '' });
    });

    it('src は http(s) の URL だけ受け付ける', () => {
        for (const src of ['https://example.com/a.webp', 'http://localhost:3001/api/v1/assets/abc.webp']) {
            expect(validateCoreComponentData(CORE_COMPONENT_TYPES.image, { src }).success, src).toBe(true);
        }
        for (const src of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/relative.png', 'ftp://x/y']) {
            expect(validateCoreComponentData(CORE_COMPONENT_TYPES.image, { src }).success, src).toBe(false);
        }
    });

    it('知らない項目は断る', () => {
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.image, { src: '', onclick: 'x' }).success).toBe(false);
    });
});

describe('core:text', () => {
    it('既定は左寄せ・24px・紺の文字・背景なし', () => {
        const result = validateCoreComponentData(CORE_COMPONENT_TYPES.text, { text: 'ようこそ' });
        expect(result.success && result.data).toEqual({
            text: 'ようこそ',
            size: 24,
            color: '#1b2a44',
            background: 'transparent',
            align: 'left',
            bold: false,
        });
    });

    it('色は #RRGGBB だけ（CSS を差し込ませない）', () => {
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.text, { color: 'red;position:fixed' }).success).toBe(
            false,
        );
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.text, { background: 'url(x)' }).success).toBe(false);
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.text, { size: 1000 }).success).toBe(false);
    });
});

describe('core:portal', () => {
    it('行き先は @ID/名前・ワールドの ID・ワールドの URL', () => {
        expect(parsePortalTarget('@alice/cafe')).toEqual({ kind: 'share', path: '@alice/cafe' });
        expect(parsePortalTarget('@alice/作業部屋')).toEqual({ kind: 'share', path: '@alice/作業部屋' });
        expect(parsePortalTarget('default')).toEqual({ kind: 'id', id: 'default' });
        expect(parsePortalTarget('https://example.com/worlds/cafe.yaml')).toEqual({
            kind: 'url',
            url: 'https://example.com/worlds/cafe.yaml',
        });
    });

    it('ほかの書き方・危ない書き方は行けない', () => {
        for (const target of ['javascript:alert(1)', '@alice/../admin', '../etc', '@a/x', 'a b', '']) {
            expect(parsePortalTarget(target), target).toBeNull();
        }
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.portal, { world: '//evil.example' }).success).toBe(false);
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.portal, {}).success).toBe(true);
    });
});

describe('isCoreComponentType', () => {
    it('足した型も本体の部品として扱う', () => {
        for (const type of ['core:image', 'core:text', 'core:portal']) expect(isCoreComponentType(type)).toBe(true);
        expect(isCoreComponentType('core:unknown')).toBe(false);
    });
});
