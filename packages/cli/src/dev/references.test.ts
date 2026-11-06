import { definitionToResolved, WorldSourceKind } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import type { ModArtifacts } from '../build.ts';
import { fakeMod } from './generation.test.ts';
import { buildRoomDefinition } from './pipeline.ts';
import { manifestFieldsOf, referenceWarnings } from './references.ts';
import { synthesizeWorld } from './synthesizedWorld.ts';

const VP_FIELDS = {
    'vp:controls': {
        dataFields: {
            screen: { type: 'entityRef', component: 'vp:screen', required: true, label: 'スクリーン' },
            playlist: { type: 'entityRef', component: 'vp:playlist' },
        },
    },
    'vp:search': { dataFields: { playlists: { type: 'entityRefArray', component: 'vp:playlist' } } },
    'vp:screen': {},
    'vp:playlist': {},
};

/** manifest に dataFields を持つ mod。 */
const vpMod = (): ModArtifacts => {
    const types = Object.keys(VP_FIELDS);
    const base = fakeMod('vp', '1.0.0', types);
    return {
        ...base,
        files: new Map([['manifest.json', new TextEncoder().encode(JSON.stringify({ components: VP_FIELDS }))]]),
    };
};

describe('manifestFieldsOf', () => {
    it('manifest の dataFields を Component 型で引く。manifest に無い型・dataFields の無い型は undefined', () => {
        const fieldsOf = manifestFieldsOf([vpMod(), fakeMod('pen')]);
        expect(fieldsOf('vp:controls')?.screen).toMatchObject({ component: 'vp:screen' });
        expect(fieldsOf('vp:screen')).toBeUndefined();
        expect(fieldsOf('pen:main')).toBeUndefined();
    });
});

describe('referenceWarnings', () => {
    it('ラベルを使い、未設定の必須参照を知らせる', () => {
        const entities = [{ id: 'c', components: [{ type: 'vp:controls', data: {} }], children: [] }];
        expect(referenceWarnings(entities, manifestFieldsOf([vpMod()]))).toEqual([
            'c の vp:controls の「スクリーン」が未設定です。vp:screen を持つ Entity を指定してください',
        ]);
    });
});

describe('synthesizeWorld の配線', () => {
    const url = 'file:///dev/world.yaml';
    const resolve = (raw: unknown) => definitionToResolved(raw, url, { kind: WorldSourceKind.Local, url });

    it('型を宣言した参照を、その型を置いた Entity に向ける（配列は全部）', () => {
        const fieldsOf = manifestFieldsOf([vpMod()]);
        const world = resolve(synthesizeWorld([{ id: 'vp', components: Object.keys(VP_FIELDS) }], fieldsOf));
        const dataOf = (type: string) =>
            world.initialEntities.find((e) => e.components[0]?.type === type)?.components[0]?.data;
        expect(dataOf('vp:controls')).toEqual({ screen: 'vp-screen', playlist: 'vp-playlist' });
        expect(dataOf('vp:search')).toEqual({ playlists: ['vp-playlist'] });
        expect(dataOf('vp:screen')).toEqual({});
        expect(referenceWarnings(world.initialEntities, fieldsOf)).toEqual([]);
    });

    it('相手の型が手元に無ければ配線しない（必須なら警告で分かる）', () => {
        const fieldsOf = manifestFieldsOf([vpMod()]);
        const world = resolve(synthesizeWorld([{ id: 'vp', components: ['vp:controls'] }], fieldsOf));
        expect(world.initialEntities[0]?.components[0]?.data).toEqual({});
        expect(referenceWarnings(world.initialEntities, fieldsOf)).toHaveLength(1);
    });
});

describe('buildRoomDefinition の警告', () => {
    it('参照の問題では止めずに知らせる', async () => {
        const mods = new Map([['vp', vpMod()]]);
        const lock = { lockVersion: 1 as const, mods: { vp: vpMod().lockEntry } };
        const world = {
            url: 'file:///p/world.yaml',
            raw: {
                apiVersion: 'ubichill.com/v1alpha1',
                kind: 'World',
                metadata: { name: 'home', version: '1.0.0' },
                spec: {
                    displayName: 'Home',
                    dependencies: [{ name: 'vp', source: { version: 'latest' } }],
                    initialEntities: [
                        {
                            id: 'c',
                            transform: { x: 0, y: 0 },
                            components: [{ type: 'vp:controls', data: { screen: 'gone' } }],
                        },
                    ],
                },
            },
        };
        const warnings: string[] = [];
        const room = await buildRoomDefinition(world, mods, lock, {
            instanceId: 'dev-x',
            maxUsers: 3,
            warn: (m) => warnings.push(m),
        });
        expect(room.id).toBe('dev-x');
        expect(warnings).toEqual(['c の vp:controls の「スクリーン」が指している Entity「gone」がありません']);
    });
});
