import { definitionToResolved, type InitialEntity, WorldSourceKind } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import type { ModArtifacts } from '../build.ts';
import { fakeMod } from './generation.test.ts';
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
    const flat = (entities: InitialEntity[]): InitialEntity[] => entities.flatMap((e) => [e, ...flat(e.children)]);
    const typed = (types: string[]) => types.map((type) => ({ type }));

    it('型を宣言した参照を、その型を置いた Entity に向ける（配列は全部）', () => {
        const fieldsOf = manifestFieldsOf([vpMod()]);
        const world = resolve(synthesizeWorld([{ id: 'vp', components: typed(Object.keys(VP_FIELDS)) }], fieldsOf));
        const dataOf = (type: string) =>
            flat(world.initialEntities).find((e) => e.components[0]?.type === type)?.components[0]?.data;
        expect(dataOf('vp:controls')).toEqual({ screen: 'vp--screen', playlist: 'vp--playlist' });
        expect(dataOf('vp:search')).toEqual({ playlists: ['vp--playlist'] });
        expect(dataOf('vp:screen')).toEqual({});
        expect(referenceWarnings(world.initialEntities, fieldsOf)).toEqual([]);
    });

    it('相手の型が手元に無ければ配線しない（必須なら警告で分かる）', () => {
        const fieldsOf = manifestFieldsOf([vpMod()]);
        const world = resolve(synthesizeWorld([{ id: 'vp', components: typed(['vp:controls']) }], fieldsOf));
        expect(flat(world.initialEntities)[1]?.components[0]?.data).toEqual({});
        expect(referenceWarnings(world.initialEntities, fieldsOf)).toHaveLength(1);
    });
});
