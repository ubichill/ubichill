import { describe, expect, it } from 'vitest';
import {
    definitionVersionOf,
    editorWorldOf,
    servedWorldOf,
    versionsToPrune,
    type WorldDraftRecord,
    type WorldState,
    type WorldVersionRecord,
} from './worldRows';

const world = {
    id: 'w',
    authorId: 'a',
    worldName: 'hello',
    currentVersionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
};
const def = (version: string, label: string) => ({
    metadata: { name: 'hello', version },
    spec: { displayName: label },
});
const version = (id: string, publishedAt: number, label = id): WorldVersionRecord => ({
    id,
    worldId: 'w',
    version: `1.0.${publishedAt}`,
    definition: def(`1.0.${publishedAt}`, label),
    lock: null,
    signature: { kind: 'world' } as unknown as WorldVersionRecord['signature'],
    contentHash: `sha256-${id}`,
    publishedAt: new Date(publishedAt * 1000),
});
const draft = (label: string): WorldDraftRecord => ({
    worldId: 'w',
    definition: def('2.0.0', label),
    lock: null,
    updatedAt: new Date(0),
});

describe('servedWorldOf（配る中身）', () => {
    it('公開中の版があれば版を配り、下書きは配らない', () => {
        const current = version('v1', 1, '公開中');
        const state: WorldState = { world: { ...world, currentVersionId: 'v1' }, current, draft: draft('編集中') };
        expect(servedWorldOf(state)).toEqual({
            definition: current.definition,
            lock: null,
            signature: current.signature,
            version: '1.0.1',
            versionId: 'v1',
        });
    });

    it('未公開なら下書きを署名なしとして配る（版の ID は無い）', () => {
        expect(servedWorldOf({ world, draft: draft('下書き') })).toEqual({
            definition: def('2.0.0', '下書き'),
            lock: null,
            signature: null,
            version: '2.0.0',
        });
    });

    it('版も下書きも無ければ配らない', () => {
        expect(servedWorldOf({ world })).toBeUndefined();
    });
});

describe('editorWorldOf（エディタの定義）', () => {
    it('公開中の版と別に下書きがあれば、下書きを返し hasDraft', () => {
        const state: WorldState = { world, current: version('v1', 1), draft: draft('編集中') };
        expect(editorWorldOf(state)).toEqual({ definition: def('2.0.0', '編集中'), hasDraft: true });
    });

    it('未公開のワールドの下書きは中身そのものなので hasDraft にしない（0023 より前と同じ）', () => {
        expect(editorWorldOf({ world, draft: draft('下書き') })).toMatchObject({ hasDraft: false });
    });

    it('下書きが無ければ公開中の版', () => {
        expect(editorWorldOf({ world, current: version('v1', 1, '公開中') })).toEqual({
            definition: def('1.0.1', '公開中'),
            hasDraft: false,
        });
    });
});

describe('versionsToPrune（残す数を超えた版）', () => {
    const versions = [version('a', 1), version('b', 2), version('c', 3), version('d', 4)];

    it('4 つ目を公開したら、いちばん古い版を消す', () => {
        expect(versionsToPrune(versions, 'd', 3)).toEqual(['a']);
    });

    it('公開中の版は古くても残し、ほかを新しい順に残す', () => {
        expect(versionsToPrune(versions, 'a', 3)).toEqual(['b']);
    });

    it('未公開（公開中なし）なら新しい順に max まで残す', () => {
        expect(versionsToPrune(versions, null, 3)).toEqual(['a']);
        expect(versionsToPrune(versions, null, 1)).toEqual(['c', 'b', 'a']);
    });

    it('上限が 0 以下でも公開中の版は消さない', () => {
        expect(versionsToPrune(versions, 'b', 0)).toEqual(['d', 'c', 'a']);
        expect(versionsToPrune(versions, 'b', -5)).not.toContain('b');
    });

    it('上限に届いていなければ何も消さない', () => {
        expect(versionsToPrune(versions.slice(0, 3), 'c', 3)).toEqual([]);
        expect(versionsToPrune([], null, 3)).toEqual([]);
    });

    it('同じ時刻の版は ID で順を決める（毎回同じ版を消す）', () => {
        const tied = [version('x', 5), version('y', 5), version('z', 5)];
        expect(versionsToPrune(tied, null, 2)).toEqual(versionsToPrune([...tied].reverse(), null, 2));
    });
});

describe('definitionVersionOf', () => {
    it('metadata.version を取り出し、無い・形が違えば空', () => {
        expect(definitionVersionOf(def('1.2.3', 'x'))).toBe('1.2.3');
        expect(definitionVersionOf({ metadata: { version: 1 } })).toBe('');
        expect(definitionVersionOf(null)).toBe('');
        expect(definitionVersionOf('yaml')).toBe('');
    });
});
