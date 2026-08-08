import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { isAlreadyPublished } from './publish.mjs';

// npm view <name>@<version> version は、そのバージョンが無いと非ゼロ終了する。
// 実ネットワークを叩かずにこの分岐を確認する（execFileSync をモック）。
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

describe('isAlreadyPublished', () => {
    it('npm view が該当バージョンを返せば true', () => {
        vi.mocked(execFileSync).mockReturnValue('0.3.0\n');
        expect(isAlreadyPublished('ubichill', '0.3.0')).toBe(true);
    });

    it('npm view が throw する（未公開バージョン）なら false', () => {
        vi.mocked(execFileSync).mockImplementation(() => {
            throw new Error('npm ERR! 404');
        });
        expect(isAlreadyPublished('ubichill', '9.9.9')).toBe(false);
    });
});
