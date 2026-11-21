import { describe, expect, it } from 'vitest';
import type { InitialEntity } from '../schemas/world.schema';
import {
    describeCoreComponentProblem,
    findCoreComponentProblems,
    unknownCoreComponentsMessage,
    unknownCoreComponentTypes,
} from './coreComponentProblems';

const entity = (
    id: string,
    components: InitialEntity['components'],
    children: InitialEntity[] = [],
): InitialEntity => ({
    id,
    transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
    components,
    tags: [],
    children,
});

describe('findCoreComponentProblems', () => {
    it('知らない部品と、知っている部品の知らない項目を、子の Entity まで挙げる', () => {
        const problems = findCoreComponentProblems([
            entity(
                'root',
                [{ type: 'core:text', data: { text: 'a', glow: true } }],
                [entity('child', [{ type: 'core:swich', data: {} }])],
            ),
        ]);
        expect(problems).toEqual([
            { entityId: 'root', componentType: 'core:text', kind: 'unknown-keys', keys: ['glow'] },
            { entityId: 'child', componentType: 'core:swich', kind: 'unknown-type' },
        ]);
    });

    it('mod の Component と、値が誤っているだけの部品は挙げない（値の誤りは schema が断る）', () => {
        expect(
            findCoreComponentProblems([
                entity('a', [
                    { type: 'pen:tray', data: { anything: 1 } },
                    { type: 'core:text', data: { text: 'a', size: -1 } },
                ]),
            ]),
        ).toEqual([]);
    });

    it('data の無い Component（CLI が読んだままの形）も調べられる', () => {
        expect(findCoreComponentProblems([{ id: 'a', components: [{ type: 'core:media' }], children: [] }])).toEqual(
            [],
        );
    });

    it('説明に部品の型と項目を入れる', () => {
        expect(
            describeCoreComponentProblem({
                entityId: 'a',
                componentType: 'core:text',
                kind: 'unknown-keys',
                keys: ['glow', 'x.y'],
            }),
        ).toContain('core:text の glow・x.y');
        expect(
            describeCoreComponentProblem({ entityId: 'a', componentType: 'core:swich', kind: 'unknown-type' }),
        ).toContain('core:swich');
    });
});

describe('unknownCoreComponentTypes', () => {
    it('知らない core の型だけを、重ねずに返す', () => {
        expect(unknownCoreComponentTypes(['core:switch', 'core:text', 'pen:tray', 'core:switch', 'core:warp'])).toEqual(
            ['core:switch', 'core:warp'],
        );
        expect(unknownCoreComponentsMessage(['core:switch', 'core:warp'])).toContain('core:switch・core:warp');
    });
});
