import { describe, expect, it } from 'vitest';
import { ModLockEntrySchema } from './modLock.schema';

const INTEGRITY = `sha256-${'A'.repeat(43)}=`;

const entry = (overrides: Record<string, unknown> = {}, workerUrl = './canvas/index.ab12cd34.js') => ({
    id: 'pen',
    version: '2.3.1',
    manifestIntegrity: INTEGRITY,
    components: { 'pen:canvas': { workerUrl, integrity: INTEGRITY, capabilities: [] } },
    ...overrides,
});

describe('ModLockEntrySchema: URL にする値は取得の前に形を確かめる', () => {
    it('ふつうの lock の値は通る', () => {
        expect(ModLockEntrySchema.safeParse(entry()).success).toBe(true);
        expect(ModLockEntrySchema.safeParse(entry({ baseUrl: 'https://mods.example.com/pages' })).success).toBe(true);
        expect(ModLockEntrySchema.safeParse(entry({}, 'canvas/index.js')).success).toBe(true);
        expect(ModLockEntrySchema.safeParse(entry({}, './a/b_c/index.d-e.js')).success).toBe(true);
    });

    it.each(['1/../../x?', '1.0', '1.0.0-beta', 'v1.0.0', '1.0.0/', '1.0.0?q', '', ' 1.0.0'])(
        'version "%s" は x.y.z でないので通さない',
        (version) => {
            expect(ModLockEntrySchema.safeParse(entry({ version })).success).toBe(false);
        },
    );

    it.each([
        '../../../api/v1/users/me',
        './../x.js',
        'a/../../x.js',
        '/mods/pen/v1/x.js',
        '//attacker.example/x.js',
        'https://attacker.example/x.js',
        'a\\..\\x.js',
        '%2e%2e/x.js',
        'a/%2E%2E/x.js',
        'x.js?q=1',
        'x.js#f',
        'a//x.js',
        './',
        '.',
        '..',
        '',
    ])('workerUrl "%s" は versioned ディレクトリの外・クエリを指せるので通さない', (workerUrl) => {
        expect(ModLockEntrySchema.safeParse(entry({}, workerUrl)).success).toBe(false);
    });

    it.each([
        'ftp://mods.example.com',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'https://user:pass@mods.example.com',
        'https://mods.example.com/?q=1',
        'https://mods.example.com/a#f',
        'https://mods.example.com\\@attacker.example',
        'not a url',
    ])('baseUrl "%s" は通さない', (baseUrl) => {
        expect(ModLockEntrySchema.safeParse(entry({ baseUrl })).success).toBe(false);
    });

    it('http の baseUrl は形としては通す（開発用の Host が自分のオリジンだけ使う。取得の可否は loader が決める）', () => {
        expect(
            ModLockEntrySchema.safeParse(entry({ baseUrl: 'http://127.0.0.1:5173/__ubichill/g/1/mods' })).success,
        ).toBe(true);
    });
});
