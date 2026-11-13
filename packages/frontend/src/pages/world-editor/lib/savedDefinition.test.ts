import { createModLock, type ModLockEntry, type WorldDefinition } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { savingChangesDefinition, withSavedFields } from './savedDefinition';

const entry = (id: string, version: string): ModLockEntry => ({
    id,
    version,
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
});

const world = (spec: Partial<WorldDefinition['spec']> = {}): WorldDefinition => ({
    apiVersion: 'ubichill.com/v1alpha1',
    kind: 'World',
    metadata: { name: 'room', version: '1.0.0' },
    spec: { displayName: 'Room', capacity: { default: 10, max: 20 }, initialEntities: [], ...spec },
});

describe('withSavedFields', () => {
    const lock = createModLock({ pen: entry('pen', '2.1.0') });

    it('版・lock・保存した ubichill の版を埋め、latest の依存を固定する', () => {
        const saved = withSavedFields(
            world({ dependencies: [{ name: 'pen', source: { version: 'latest' } }] }),
            { lock, version: '1.0.1' },
            7,
        );
        expect(saved.metadata.version).toBe('1.0.1');
        expect(saved.spec.lock).toBe(lock);
        expect(saved.spec.requires).toEqual({ protocol: 7 });
        expect(saved.spec.dependencies).toEqual([{ name: 'pen', source: { version: '2.1.0' } }]);
    });

    it('依存の無いワールドに空の dependencies を作らない', () => {
        expect('dependencies' in withSavedFields(world(), { lock, version: '1.0.0' }, 7).spec).toBe(false);
    });

    it('新しい ubichill で保存したワールドの印を下げない', () => {
        expect(
            withSavedFields(world({ requires: { protocol: 9 } }), { lock, version: '1.0.0' }, 7).spec.requires,
        ).toEqual({
            protocol: 9,
        });
    });

    it('同じ項目で差し替え直しても変わらない（保存後に未保存の差分が出ない）', () => {
        const fields = { lock, version: '1.0.1' };
        const once = withSavedFields(
            world({ dependencies: [{ name: 'pen', source: { version: 'latest' } }] }),
            fields,
            7,
        );
        expect(withSavedFields(once, fields, 7)).toEqual(once);
    });

    it('保存を待つ間に足した Entity は残す', () => {
        const edited = world({
            initialEntities: [
                {
                    id: 'added',
                    transform: { x: 0, y: 0, z: 0, w: 1, h: 1, scale: 1, rotation: 0 },
                    components: [],
                    tags: [],
                    children: [],
                },
            ],
        });
        expect(withSavedFields(edited, { lock, version: '1.0.1' }, 7).spec.initialEntities).toHaveLength(1);
    });
});

describe('savingChangesDefinition', () => {
    it('今の ubichill で保存済みで、版を固定していれば変わらない', () => {
        expect(
            savingChangesDefinition(
                world({ requires: { protocol: 7 }, dependencies: [{ name: 'pen', source: { version: '2.1.0' } }] }),
                7,
            ),
        ).toBe(false);
    });

    it('ubichill が更新されたら変わる（公開済みと同じ版のまま違う中身にしない）', () => {
        expect(savingChangesDefinition(world({ requires: { protocol: 6 } }), 7)).toBe(true);
        expect(savingChangesDefinition(world(), 7)).toBe(true);
    });

    it('latest の依存が残っていれば変わる', () => {
        expect(
            savingChangesDefinition(
                world({ requires: { protocol: 7 }, dependencies: [{ name: 'pen', source: { version: 'latest' } }] }),
                7,
            ),
        ).toBe(true);
    });
});
