import { describe, expect, it } from 'vitest';
import { type DiscoverFs, discoverModDirs } from './discover.ts';

/** パス → package.json の中身（ディレクトリは中身の無いエントリ）。 */
const memoryFs = (entries: Record<string, unknown>): DiscoverFs => ({
    exists: (path) => path in entries || Object.keys(entries).some((p) => p.startsWith(`${path}/`)),
    listDirs: (path) => [
        ...new Set(
            Object.keys(entries)
                .filter((p) => p.startsWith(`${path}/`))
                .map((p) => p.slice(path.length + 1).split('/')[0] as string)
                .filter((name) => !name.includes('.')),
        ),
    ],
    readJson: (path) => entries[path],
});

describe('discoverModDirs', () => {
    it('mod のリポジトリ（package.json と src/）は cwd が 1 つの mod。id は ubichill.id か名前から', () => {
        const fs = memoryFs({
            '/vp/package.json': { name: 'ubichill-videoplayer', ubichill: { id: 'video-player' } },
            '/vp/src/screen.worker.tsx': '',
        });
        expect(discoverModDirs('/vp', undefined, fs)).toEqual({ modDirs: new Map([['video-player', '/vp']]) });
    });

    it('ワールドだけのリポジトリ（src/ が無い）は手元の mod 0。cwd を mod としてビルドしない', () => {
        const fs = memoryFs({ '/w/package.json': { name: 'ubichill-worlds' }, '/w/worlds/chillwa.yaml': '' });
        expect(discoverModDirs('/w', undefined, fs).modDirs.size).toBe(0);
    });

    it('mods/ があればその下の package.json を持つディレクトリだけ。cwd の src/ は見ない', () => {
        const fs = memoryFs({
            '/m/package.json': { name: 'root' },
            '/m/src/x.ts': '',
            '/m/mods/pen/package.json': { name: '@ubichill/mod-pen' },
            '/m/mods/notes/README': '',
            '/m/mods/danmaku/package.json': { name: 'danmaku' },
        });
        const found = discoverModDirs('/m', undefined, fs);
        expect(found.modsRoot).toBe('/m/mods');
        expect([...found.modDirs.entries()].sort()).toEqual([
            ['danmaku', '/m/mods/danmaku'],
            ['pen', '/m/mods/pen'],
        ]);
    });

    it('src/ はあるのに package.json が無ければ、黙って 0 にせず知らせる', () => {
        expect(() => discoverModDirs('/x', undefined, memoryFs({ '/x/src/a.ts': '' }))).toThrow(/package\.json/);
    });
});
