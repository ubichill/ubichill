import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkMigrations, ROOT_SNAPSHOT_ID } from './migrations.mjs';

const entry = (idx, when, tag) => ({ idx, when, tag });
const journalOf = (...entries) => ({ entries });
const snapshotsOf = (...pairs) => new Map(pairs.map(([prefix, id, prevId]) => [prefix, { id, prevId }]));

const good = () => ({
    journal: journalOf(entry(0, 100, '0000_init'), entry(1, 200, '0001_users'), entry(2, 300, '0002_posts')),
    snapshots: snapshotsOf(['0000', 'a', ROOT_SNAPSHOT_ID], ['0001', 'b', 'a'], ['0002', 'c', 'b']),
    sql: ['0000_init', '0001_users', '0002_posts'],
});

describe('checkMigrations', () => {
    it('順に並び鎖がつながっていれば問題なし', () => {
        const { journal, snapshots, sql } = good();
        expect(checkMigrations(journal, snapshots, sql)).toEqual([]);
    });

    it('並行した PR で when が前より古いと落ちる（drizzle が黙って飛ばす）', () => {
        const { snapshots, sql } = good();
        const journal = journalOf(entry(0, 100, '0000_init'), entry(1, 300, '0001_users'), entry(2, 250, '0002_posts'));
        expect(checkMigrations(journal, snapshots, sql)).toEqual([expect.stringContaining('0002_posts: when')]);
    });

    it('when が同じでも落ちる（新しくないので当たらない）', () => {
        const { snapshots, sql } = good();
        const journal = journalOf(entry(0, 100, '0000_init'), entry(1, 200, '0001_users'), entry(2, 200, '0002_posts'));
        expect(checkMigrations(journal, snapshots, sql)).toHaveLength(1);
    });

    it('同じ親から 2 つ生成した（prevId が前の id でない）と落ちる', () => {
        const { journal, sql } = good();
        const snapshots = snapshotsOf(['0000', 'a', ROOT_SNAPSHOT_ID], ['0001', 'b', 'a'], ['0002', 'c', 'a']);
        expect(checkMigrations(journal, snapshots, sql)).toEqual([expect.stringContaining('0002_posts: snapshot の prevId')]);
    });

    it('最初の snapshot は根から始まる', () => {
        const { journal, sql } = good();
        const snapshots = snapshotsOf(['0000', 'a', 'x'], ['0001', 'b', 'a'], ['0002', 'c', 'b']);
        expect(checkMigrations(journal, snapshots, sql)).toHaveLength(1);
    });

    it('idx の飛び・ファイルの欠け・journal に無いファイルを拾う', () => {
        const { snapshots } = good();
        const journal = journalOf(entry(0, 100, '0000_init'), entry(2, 200, '0001_users'), entry(3, 300, '0002_posts'));
        const problems = checkMigrations(journal, snapshots, ['0000_init', '0002_posts', '0003_orphan']);
        expect(problems).toEqual([
            expect.stringContaining('0001_users: idx'),
            expect.stringContaining('0002_posts: idx'),
            expect.stringContaining('0001_users: 0001_users.sql が無い'),
            expect.stringContaining('0003_orphan.sql: journal に無い'),
        ]);
    });

    it('snapshot が無い・journal に無い snapshot を拾う', () => {
        const { journal, sql } = good();
        const snapshots = snapshotsOf(['0000', 'a', ROOT_SNAPSHOT_ID], ['0001', 'b', 'a'], ['0009', 'z', 'b']);
        expect(checkMigrations(journal, snapshots, sql)).toEqual([
            expect.stringContaining('0009_snapshot.json: journal に無い'),
            expect.stringContaining('0002_posts: 0002_snapshot.json が無い'),
        ]);
    });
});

describe('リポジトリのマイグレーション', () => {
    it('packages/db/drizzle が規則を満たす', () => {
        const dir = new URL('../packages/db/drizzle/', import.meta.url);
        const json = (name) => JSON.parse(readFileSync(new URL(`meta/${name}`, dir), 'utf-8'));
        const snapshots = new Map(
            readdirSync(new URL('meta/', dir))
                .filter((n) => n.endsWith('_snapshot.json'))
                .map((n) => [n.split('_')[0], json(n)]),
        );
        const sql = readdirSync(dir)
            .filter((n) => n.endsWith('.sql'))
            .map((n) => n.slice(0, -4));
        expect(checkMigrations(json('_journal.json'), snapshots, sql)).toEqual([]);
    });
});
