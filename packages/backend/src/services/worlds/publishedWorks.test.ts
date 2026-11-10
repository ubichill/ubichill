import type { WorldRecord } from '@ubichill/db';
import type { ResolvedWorld, WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import type { PublishedExternalEntry } from './externalWorkStore';
import { createPublishedWorks, type PublishedWorksDeps } from './publishedWorks';

const at = (day: number) => new Date(Date.UTC(2026, 10, day));

const world = (id: string, identity: ResolvedWorld['identity']): ResolvedWorld =>
    ({
        id,
        displayName: `World ${id}`,
        version: '1.0.0',
        capacity: { default: 8, max: 16 },
        identity,
    }) as ResolvedWorld;

const signed = { status: 'verified', author: 'alice@a.example' } as unknown as ResolvedWorld['identity'];
const unsigned = { status: 'unsigned' } as unknown as ResolvedWorld['identity'];

const record = (id: string, day: number) => ({ id, createdAt: at(day) }) as WorldRecord;

const listItem = (id: string) =>
    ({
        id,
        url: `https://pages.example/${id}`,
        displayName: id,
        version: '1',
        capacity: { default: 1, max: 1 },
    }) as unknown as WorldListItem;

function setup(overrides: Partial<PublishedWorksDeps> = {}) {
    const asked: string[] = [];
    const deps: PublishedWorksDeps = {
        worldsByAuthor: async () => [record('w1', 1), record('w2', 2), record('gone', 3), record('w3', 4)],
        getWorld: async (id) =>
            id === 'w1'
                ? world('w1', signed)
                : id === 'w2'
                  ? world('w2', unsigned)
                  : id === 'w3'
                    ? world('w3', signed)
                    : undefined,
        repositoryWorldsByAuthor: async (accounts) => {
            asked.push(...accounts);
            return accounts.length > 0 ? [world('repo', signed)] : [];
        },
        externalEntries: async (): Promise<PublishedExternalEntry[]> => [
            { registeredAt: at(5), world: listItem('ext') },
            { registeredAt: at(6), mod: { name: 'mod-a', version: '2.0.0' } as never },
        ],
        accountOf: (handle) => `${handle}@a.example`,
        ...overrides,
    };
    return { works: createPublishedWorks(deps), asked };
}

describe('publishedWorks', () => {
    it('本体のワールドは署名して公開したものだけ。消えた（解決できない）ものも出さず、作った順と時刻を保つ', async () => {
        const { works } = setup();
        const hosted = await works.hostedWorlds('alice');
        expect(hosted.map((h) => [h.world.id, h.createdAt])).toEqual([
            ['w1', at(1)],
            ['w3', at(4)],
        ]);
    });

    it('ユーザーページの一覧は 本体 → リポジトリ → 外部 の順で、本体の分は公開メタデータだけ', async () => {
        const { works, asked } = setup();
        const worlds = await works.worldsOf('alice', { id: 'alice', handle: 'alice' });
        expect(worlds.map((w) => w.id)).toEqual(['w1', 'w3', 'repo', 'ext']);
        expect(worlds[0]).not.toHaveProperty('identity');
        expect(worlds[2]).toMatchObject({ managedBy: 'repository' });
        expect(worlds[3]).toMatchObject({ managedBy: 'external', url: 'https://pages.example/ext' });
        expect(asked).toEqual(['alice@a.example']);
    });

    it('ユーザーが居なければ（消えた）本体の分だけ。リポジトリは作者なしで問い合わせ、外部は取りに行かない', async () => {
        const external: string[] = [];
        const { works, asked } = setup({
            externalEntries: async (userId) => {
                external.push(userId);
                return [];
            },
        });
        expect((await works.worldsOf('ghost', undefined)).map((w) => w.id)).toEqual(['w1', 'w3']);
        expect(asked).toEqual([]);
        expect(external).toEqual([]);
    });

    it('mod は外部の作品のうち mod だけ', async () => {
        const { works } = setup();
        expect(await works.modsOf({ id: 'alice', handle: 'alice' })).toEqual([{ name: 'mod-a', version: '2.0.0' }]);
    });
});
