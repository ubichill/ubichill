import { describe, expect, it } from 'vitest';
import { findOverwrites } from './check-published-mods.mjs';

/** パス → 中身。ディレクトリは中身の無いパスから作る。 */
const memoryFs = (files) => {
    const paths = Object.keys(files);
    return {
        listDirs: (dir) => [
            ...new Set(
                paths
                    .filter((p) => p.startsWith(`${dir}/`))
                    .map((p) => p.slice(dir.length + 1).split('/'))
                    .filter((parts) => parts.length > 1)
                    .map((parts) => parts[0]),
            ),
        ],
        read: (path) => (path in files ? new TextEncoder().encode(files[path]) : null),
    };
};

const mod = (root, name, version, manifest, lock = 'lock') => ({
    [`${root}/${name}/v${version}/manifest.json`]: manifest,
    [`${root}/${name}/v${version}/lock.json`]: lock,
});

describe('findOverwrites', () => {
    it('公開済みの版と中身が同じなら止めない。まだ公開していない版も止めない', () => {
        const fs = memoryFs({
            ...mod('/dist', 'pen', '2.0.0', 'm1'),
            ...mod('/pub', 'pen', '2.0.0', 'm1'),
            ...mod('/dist', 'pen', '2.1.0', 'm2'),
        });
        expect(findOverwrites('/dist', '/pub', fs)).toEqual([]);
    });

    it('同じ版のまま manifest か lock の中身が変わったら止める（SDK の変更で Worker が変わった場合も）', () => {
        const fs = memoryFs({
            ...mod('/dist', 'pen', '2.0.0', 'm1-new'),
            ...mod('/pub', 'pen', '2.0.0', 'm1'),
            ...mod('/dist', 'danmaku', '1.0.0', 'd', 'lock-new'),
            ...mod('/pub', 'danmaku', '1.0.0', 'd', 'lock'),
        });
        expect(findOverwrites('/dist', '/pub', fs)).toEqual([
            { mod: 'pen', version: '2.0.0' },
            { mod: 'danmaku', version: '1.0.0' },
        ]);
    });

    it('公開済みの版の片方のファイルが無い・ビルドに無いなら、比べられないので止める', () => {
        const fs = memoryFs({
            ...mod('/dist', 'pen', '2.0.0', 'm1'),
            '/pub/pen/v2.0.0/manifest.json': 'm1',
        });
        expect(findOverwrites('/dist', '/pub', fs)).toEqual([{ mod: 'pen', version: '2.0.0' }]);
    });

    it('v で始まる mod の ID を版のディレクトリと取り違えない', () => {
        const fs = memoryFs({
            ...mod('/dist', 'video-player', '3.1.0', 'v'),
            ...mod('/pub', 'video-player', '3.1.0', 'v'),
        });
        expect(findOverwrites('/dist', '/pub', fs)).toEqual([]);
    });
});
