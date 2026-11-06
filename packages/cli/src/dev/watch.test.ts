import { describe, expect, it } from 'vitest';
import { isIgnoredPath, planChanges, watchTargets } from './watch.ts';

const input = {
    modDirs: new Map([
        ['pen', '/p/mods/pen'],
        ['danmaku', '/p/mods/danmaku'],
    ]),
    inputsByMod: new Map([
        [
            'pen',
            new Set(['/p/mods/pen/src/pen.worker.tsx', '/p/shared/colors.ts', '/p/node_modules/ubichill/index.js']),
        ],
        ['danmaku', new Set(['/p/mods/danmaku/src/wall.worker.ts', '/p/shared/colors.ts'])],
    ]),
    modsRoot: '/p/mods',
    worldPath: '/p/world.yaml',
};

describe('planChanges', () => {
    it('mod の中の変更はその mod だけ（ソース・package.json・asset・Worker の追加）', () => {
        for (const path of [
            '/p/mods/pen/src/pen.worker.tsx',
            '/p/mods/pen/package.json',
            '/p/mods/pen/assets/a.png',
            '/p/mods/pen/src/new.worker.ts',
            '/p/mods/pen/tsconfig.json',
        ]) {
            const plan = planChanges([path], input);
            expect([...plan.rebuild], path).toEqual(['pen']);
            expect(plan.rescan).toBe(false);
            expect(plan.reconfigure).toBe(false);
        }
    });

    it('mod の外の共有コードは、それを読んだ mod をすべてビルドする', () => {
        expect([...planChanges(['/p/shared/colors.ts'], input).rebuild].sort()).toEqual(['danmaku', 'pen']);
    });

    it('mod のディレクトリの追加・削除は一覧の探し直し、world.yaml とその横の lock はワールドの作り直し', () => {
        expect(planChanges(['/p/mods/new-mod'], input)).toMatchObject({ rescan: true, reconfigure: false });
        expect(planChanges(['/p/world.yaml'], input)).toMatchObject({ rescan: false, reconfigure: true });
        expect(planChanges(['/p/world.lock.json'], input)).toMatchObject({ rescan: false, reconfigure: true });
        expect(planChanges(['/p/other.lock.json'], input).reconfigure).toBe(false);
    });

    it('node_modules・dist・無関係なファイルは何もしない', () => {
        for (const path of [
            '/p/node_modules/ubichill/index.js',
            '/p/mods/pen/dist/x.js',
            '/p/README.md',
            '/p/.git/HEAD',
        ]) {
            const plan = planChanges([path], input);
            expect(plan.rebuild.size, path).toBe(0);
            expect(plan.rescan).toBe(false);
            expect(plan.reconfigure).toBe(false);
        }
        expect(isIgnoredPath('/p/mods/pen/.ubichill/x')).toBe(true);
    });

    it('似た名前のディレクトリ（pen2）を pen と取り違えない', () => {
        expect(planChanges(['/p/mods/pen2/src/x.ts'], input).rebuild.size).toBe(0);
    });
});

describe('watchTargets', () => {
    it('mod は再帰、外の入力は親ディレクトリ、mod の一覧と world.yaml のディレクトリは直下だけ', () => {
        expect(watchTargets(input)).toEqual([
            { path: '/p/mods/pen', recursive: true },
            { path: '/p/mods/danmaku', recursive: true },
            { path: '/p/shared', recursive: false },
            { path: '/p/mods', recursive: false },
            { path: '/p', recursive: false },
        ]);
    });
    it('node_modules の中と、再帰で見ている mod の中の入力は別に監視しない', () => {
        const targets = watchTargets({ ...input, modsRoot: undefined, worldPath: undefined });
        expect(targets.map((t) => t.path)).toEqual(['/p/mods/pen', '/p/mods/danmaku', '/p/shared']);
    });
});
