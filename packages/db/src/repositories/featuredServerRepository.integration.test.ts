import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { featuredFediverseServers } from '../schema';
import { featuredServerRepository } from './featuredServerRepository';

/** 並べるサーバーの DB 統合テスト。DATABASE_URL がある時だけ走る（表を空にして使い、終わったら元に戻す）。 */
const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)('featuredServerRepository (DB統合)', () => {
    const saved: Array<{ host: string; position: number }> = [];
    beforeAll(async () => {
        saved.push(...(await db.select().from(featuredFediverseServers)));
        await db.delete(featuredFediverseServers);
    });
    afterAll(async () => {
        await db.delete(featuredFediverseServers);
        if (saved.length > 0) await db.insert(featuredFediverseServers).values(saved);
    });

    it('マイグレーションで今までの 4 つが入っている', () => {
        expect(saved.map((s) => s.host).sort()).toEqual(
            ['mastodon.social', 'misskey.io', 'misskey.niri.la', 'mstdn.jp'].sort(),
        );
    });

    it('末尾に足し、同じものは足さず、上限を超えない。同時に足しても上限は守る', async () => {
        expect(await featuredServerRepository.add('a.example', 3)).toBe('added');
        expect(await featuredServerRepository.add('a.example', 3)).toBe('exists');
        const outcomes = await Promise.all(
            ['b.example', 'c.example', 'd.example', 'e.example'].map((h) => featuredServerRepository.add(h, 3)),
        );
        expect(outcomes.filter((o) => o === 'added')).toHaveLength(2);
        expect(outcomes.filter((o) => o === 'full')).toHaveLength(2);
        const list = await featuredServerRepository.list();
        expect(list).toHaveLength(3);
        expect(list[0]).toBe('a.example');
    });

    it('並べ替えは同じ組のときだけ。外したものは消え、次に足すと末尾に付く', async () => {
        const list = await featuredServerRepository.list();
        const reversed = [...list].reverse();
        expect(await featuredServerRepository.reorder(reversed)).toBe('reordered');
        expect(await featuredServerRepository.list()).toEqual(reversed);
        expect(await featuredServerRepository.reorder(reversed.slice(1))).toBe('mismatch');
        expect(await featuredServerRepository.reorder([...reversed.slice(1), 'x.example'])).toBe('mismatch');
        expect(await featuredServerRepository.reorder([reversed[0] ?? '', reversed[0] ?? '', reversed[1] ?? ''])).toBe(
            'mismatch',
        );
        expect(await featuredServerRepository.remove(reversed[0] ?? '')).toBe(true);
        expect(await featuredServerRepository.remove(reversed[0] ?? '')).toBe(false);
        expect(await featuredServerRepository.add('z.example', 3)).toBe('added');
        expect((await featuredServerRepository.list()).at(-1)).toBe('z.example');
    });
});
