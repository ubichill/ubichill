import { describe, expect, it } from 'vitest';
import { createModLock, ModLockSchema } from '../schemas/modLock.schema';
import { formatPackageRef, parsePackageRef } from './packageRef';
import { instantiatePrefab, PrefabSchema, unpackPrefab, updatePrefabInstance, validatePackagePrefabs } from './prefab';

const prefab = (text = '元の内容', x = 10) =>
    PrefabSchema.parse({
        name: 'セット',
        entities: [
            { id: 'label', transform: { x, y: 0 }, components: [{ type: 'core:ui', data: { markup: text } }] },
            {
                id: 'button',
                transform: { x: 0, y: 0 },
                components: [{ type: 'demo:button', data: { target: 'label', label: 'label' } }],
            },
        ],
    });
const fields = { 'demo:button': { dataFields: { target: { type: 'entityRef' as const, component: 'core:ui' } } } };
const entry = {
    id: 'demo',
    version: '1.0.0',
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    author: 'alice@example.com',
    components: {},
};

describe('package identity', () => {
    it('作者参照と作品ページは同じ参照になる', () => {
        const ref = parsePackageRef('@alice@example.com/demo@1.2.3');
        expect(ref).toEqual(parsePackageRef('https://example.com/@alice/mods/demo/versions/1.2.3'));
        if (!ref) throw new Error('ref missing');
        expect(formatPackageRef(ref)).toBe('@alice@example.com/demo@1.2.3');
    });
    it.each([
        '@alice@example.com/core',
        '@alice@example.com/../bad',
        'https://evil@other/@alice/mods/demo',
        '@alice@example.com/demo@latest',
    ])('不正な参照を拒否する: %s', (s) => expect(parsePackageRef(s)).toBeNull());
    it('旧 Host が作者固定を読み飛ばして実行できない wire 形式にする', () => {
        const lock = createModLock({ demo: entry });
        expect(lock).toEqual({ lockVersion: 2, mods: {}, packages: { demo: entry } });
        expect(ModLockSchema.safeParse({ lockVersion: 1, mods: { demo: entry } }).success).toBe(false);
        expect(ModLockSchema.safeParse({ lockVersion: 2, mods: { demo: entry } }).success).toBe(false);
    });
});
describe('linked prefab', () => {
    it('二つ置いても参照が混ざらず、同じ文字列の表示名は変えない', () => {
        const first = instantiatePrefab(entry, 'set', prefab(), fields, [], 'root-a');
        const second = instantiatePrefab(entry, 'set', prefab(), fields, [first], 'root-b');
        expect(second.children[0].id).not.toBe(first.children[0].id);
        expect(second.children[1].components[0].data).toEqual({ target: second.children[0].id, label: 'label' });
    });
    it('作者側の変更を取り込み、配置側の位置と競合したテキストを保持する', () => {
        const original = prefab();
        const placed = instantiatePrefab(entry, 'set', original, fields, [], 'root');
        placed.children[0].transform.x = 88;
        placed.children[0].components[0].data.markup = '配置側の編集';
        const result = updatePrefabInstance(
            placed,
            { prefab: original, fields },
            { prefab: prefab('作者の更新'), fields, entry: { ...entry, version: '2.0.0' } },
            [placed],
        );
        expect(result.entity.children[0].transform.x).toBe(88);
        expect(result.entity.children[0].components[0].data.markup).toBe('配置側の編集');
        expect(result.conflicts).toEqual(['/label/components/core:ui/data/markup']);
        expect(result.entity.prefab?.version).toBe('2.0.0');
    });
    it('Unpack は構成を保ち、関連だけを外す', () => {
        const placed = instantiatePrefab(entry, 'set', prefab(), fields, [], 'root');
        expect(unpackPrefab(placed)).not.toHaveProperty('prefab');
        expect(unpackPrefab(placed).children).toEqual(placed.children);
    });
    it('別作者への置換と外部 Entity への参照を拒否する', () => {
        const original = prefab();
        const placed = instantiatePrefab(entry, 'set', original, fields, [], 'root');
        expect(() =>
            updatePrefabInstance(
                placed,
                { prefab: original, fields },
                { prefab: original, fields, entry: { ...entry, author: 'mallory@example.com' } },
                [placed],
            ),
        ).toThrow();
        original.entities[1].components[0].data.target = 'outside';
        expect(() => validatePackagePrefabs('demo', { set: original }, fields)).toThrow();
    });
});
