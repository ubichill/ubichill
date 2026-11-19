import { describe, expect, it } from 'vitest';
import { browserCommand } from './account.ts';

describe('browserCommand', () => {
    const url = 'https://ubichill.com/cli/authorize?request=1&state=s&calc';

    it.each([
        ['darwin', 'open'],
        ['win32', 'explorer.exe'],
        ['linux', 'xdg-open'],
        ['freebsd', 'xdg-open'],
    ] as const)('%s では %s に URL を 1 つの引数で渡す', (platform, command) => {
        expect(browserCommand(platform, url)).toEqual([command, [url]]);
    });

    it('Windows でも cmd を通さない（& で URL が切れ、続きがコマンドとして動くので）', () => {
        const [command, args] = browserCommand('win32', url);
        expect(command).not.toMatch(/^cmd/i);
        expect(args).toEqual([url]);
    });
});
