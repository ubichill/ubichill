import type { InitialEntity, ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { buildWorldLock, collectModIds } from './buildWorldLock';

/** テスト用 Entity（transform は最小）。 */
function entity(id: string, types: string[], children: InitialEntity[] = []): InitialEntity {
    return {
        id,
        transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
        components: types.map((type) => ({ type, data: {} })),
        tags: [],
        children,
    };
}

function lockEntry(id: string): ModLockEntry {
    return { id, version: '1.0.0', manifestIntegrity: 'sha256-M', components: {} };
}

describe('collectModIds', () => {
    it('子孫を含めて modId を重複なく集める', () => {
        const tree = [
            entity('a', ['pen:pen', 'pen:tray'], [entity('b', ['video-player:screen'])]),
            entity('c', ['pen:canvas']),
        ];
        expect(collectModIds(tree).sort()).toEqual(['pen', 'video-player']);
    });

    it('コロンを含まない不正 type は modId 側（先頭）を拾う（防御的）', () => {
        // ComponentType はスキーマ上 "mod:name" 形式だが、split 実装の堅牢性を確認。
        expect(collectModIds([entity('a', ['solo'])])).toEqual(['solo']);
    });

    it('空ツリーは空配列', () => {
        expect(collectModIds([])).toEqual([]);
    });
});

describe('buildWorldLock', () => {
    it('取得できた mod だけを lock.mods に載せ、取得不能は除外する', async () => {
        const getter = async (id: string) => (id === 'pen' ? lockEntry('pen') : null);
        const lock = await buildWorldLock(['pen', 'ghost'], getter);
        expect(lock.lockVersion).toBe(1);
        expect(Object.keys(lock.mods)).toEqual(['pen']);
        expect(lock.mods.pen.id).toBe('pen');
    });

    it('全 mod が取得不能なら空 lock（外部公開時は読む側で lock-missing 拒否）', async () => {
        const lock = await buildWorldLock(['a', 'b'], async () => null);
        expect(lock.mods).toEqual({});
    });
});
