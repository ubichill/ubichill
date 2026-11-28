import { describe, expect, it } from 'vitest';
import { editedFiles } from './edited-files.mjs';

const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n');

describe('editedFiles', () => {
    it('Claude Code は file_path をそのまま使う（相対なら cwd から）', () => {
        expect(editedFiles({ file_path: '/repo/a.ts' }, '/repo')).toEqual(['/repo/a.ts']);
        expect(editedFiles({ file_path: 'src/a.ts' }, '/repo')).toEqual(['/repo/src/a.ts']);
    });

    it('Codex の apply_patch は足したファイル・直したファイル・移した先を返し、消したファイルは返さない', () => {
        const command = patch(
            '*** Add File: src/new.ts',
            '+export const a = 1;',
            '*** Update File: src/old.ts',
            '*** Move to: src/renamed.ts',
            '@@',
            '-a',
            '+b',
            '*** Delete File: src/gone.ts',
            '*** Update File: /abs/x.ts',
            '@@',
            '+c',
        );
        expect(editedFiles({ command }, '/repo')).toEqual([
            '/repo/src/new.ts',
            '/repo/src/old.ts',
            '/repo/src/renamed.ts',
            '/abs/x.ts',
        ]);
    });

    it('同じファイルを 2 回直しても 1 回だけ返す', () => {
        const command = patch('*** Update File: a.ts', '@@', '+1', '*** Update File: a.ts', '@@', '+2');
        expect(editedFiles({ command }, '/r')).toEqual(['/r/a.ts']);
    });

    it('パッチの本文の行に見出しに似た文字があっても、行頭でなければ拾わない', () => {
        const command = patch('*** Update File: a.ts', '@@', '+// *** Add File: fake.ts');
        expect(editedFiles({ command }, '/r')).toEqual(['/r/a.ts']);
    });

    it('パッチではない command（Bash）や形の違う入力は何も返さない', () => {
        expect(editedFiles({ command: 'echo "*** Add File: x"' }, '/r')).toEqual([]);
        expect(editedFiles(undefined, '/r')).toEqual([]);
        expect(editedFiles('text', '/r')).toEqual([]);
        expect(editedFiles({ file_path: 1 }, '/r')).toEqual([]);
    });
});
