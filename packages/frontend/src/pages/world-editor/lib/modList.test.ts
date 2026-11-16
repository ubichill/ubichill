import { createModLock, type Dependency, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { type ListableMod, modListRows } from './modList';

const mod = (id: string, version: string, extra: Partial<ListableMod> = {}): ListableMod => ({
    id,
    name: id,
    version,
    ...extra,
});
const entry = (id: string, version: string): ModLockEntry => ({
    id,
    version,
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
});
const dep = (name: string, version: string, url?: string): Dependency => ({
    name,
    source: { version, ...(url ? { url } : {}) },
});

const base = { selected: [], dependencies: [], lock: undefined, query: '' };

describe('modListRows', () => {
    it('入っている mod を上にまとめ、あとは名前順', () => {
        const rows = modListRows({
            ...base,
            mods: [mod('pen', '2.1.0'), mod('danmaku', '1.0.2'), mod('wasm-demo', '1.0.0')],
            selected: [{ id: 'wasm-demo', version: '1.0.0' }],
            dependencies: [dep('wasm-demo', '1.0.0')],
        });
        expect(rows.map((r) => r.key.trim())).toEqual(['wasm-demo', 'danmaku', 'pen']);
    });

    it('選んだだけでは並びを変えない（押した行が動かない）', () => {
        const rows = modListRows({
            ...base,
            mods: [mod('pen', '2.1.0'), mod('danmaku', '1.0.2')],
            selected: [{ id: 'pen', version: '2.1.0' }],
        });
        expect(rows.map((r) => r.key.trim())).toEqual(['danmaku', 'pen']);
        expect(rows[1]).toMatchObject({ selected: true, installed: false });
    });

    it('古い版を使っていれば outdated、選べる版は使う版を含めて新しい順', () => {
        const [row] = modListRows({
            ...base,
            mods: [mod('pen', '2.1.0', { versions: [{ version: '2.1.0' }] })],
            selected: [{ id: 'pen', version: '1.9.0' }],
            dependencies: [dep('pen', '1.9.0')],
        });
        expect(row).toMatchObject({
            kind: 'available',
            version: '1.9.0',
            outdated: true,
            versions: ['2.1.0', '1.9.0'],
        });
    });

    it('latest のままの依存は lock の版を使う版として出す', () => {
        const [row] = modListRows({
            ...base,
            mods: [mod('pen', '2.1.0', { versions: [{ version: '2.1.0' }, { version: '2.0.0' }] })],
            selected: [{ id: 'pen', version: 'latest' }],
            dependencies: [dep('pen', 'latest')],
            lock: createModLock({ pen: entry('pen', '2.0.0') }),
        });
        expect(row).toMatchObject({ version: '2.0.0', outdated: true });
    });

    it('同じ ID でも取得元が違う mod は別の行として扱う', () => {
        const rows = modListRows({
            ...base,
            mods: [mod('pen', '2.1.0'), mod('pen', '9.0.0', { baseUrl: 'https://cdn.example/mods' })],
            selected: [{ id: 'pen', version: '2.1.0' }],
            dependencies: [dep('pen', '2.1.0')],
        });
        expect(rows.map((r) => r.kind === 'available' && [r.mod.version, r.installed, r.blocked])).toEqual([
            ['2.1.0', true, false],
            ['9.0.0', false, true],
        ]);
    });

    it('取得元の一覧に無い依存（作者参照）も行に出す', () => {
        const rows = modListRows({
            ...base,
            mods: [mod('pen', '2.1.0')],
            selected: [
                { id: 'video-player', version: '4.0.0', author: 'youkan@ubichill.com', baseUrl: 'https://vp.example' },
            ],
            dependencies: [dep('video-player', '4.0.0', 'https://vp.example')],
        });
        expect(rows[0]).toMatchObject({ kind: 'extra', installed: true });
    });

    it('名前・ID・作者の部分一致で絞り込む（大文字小文字を区別しない）', () => {
        const input = {
            ...base,
            mods: [mod('pen', '2.1.0', { name: 'Pen Tool' }), mod('danmaku', '1.0.2')],
            selected: [{ id: 'video-player', version: '4.0.0', author: 'youkan@ubichill.com' }],
        };
        expect(modListRows({ ...input, query: 'TOOL' }).map((r) => r.key.trim())).toEqual(['pen']);
        expect(modListRows({ ...input, query: ' youkan ' }).map((r) => r.kind)).toEqual(['extra']);
        expect(modListRows({ ...input, query: 'none' })).toEqual([]);
    });
});
