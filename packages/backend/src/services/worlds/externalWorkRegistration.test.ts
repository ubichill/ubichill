import { beforeEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ register: vi.fn(), confirm: vi.fn(), verify: vi.fn() }));
vi.mock('@ubichill/db', () => ({ externalWorkRepository: { registerWithinLimit: fake.register } }));
vi.mock('./externalWorkService', () => ({ confirmModRegistration: fake.confirm }));
vi.mock('./externalWorks', () => ({ verifyRegistration: fake.verify }));
vi.mock('../authors/authorKeyService', () => ({ isAuthorKey: vi.fn() }));
vi.mock('../authors/authorKeys', () => ({ selfAccount: (handle: string) => `${handle}@example.com` }));
vi.mock('../federation', () => ({ federation: undefined }));

import { registerExternalWork } from './externalWorkRegistration';

const registration = {
    kind: 'mod' as const,
    url: 'https://cdn.example/mods',
    entry: { id: 'demo', version: '2.0.0', manifestIntegrity: `sha256-${'A'.repeat(43)}=`, components: {} },
    signature: {},
};
beforeEach(() => {
    vi.clearAllMocks();
    fake.verify.mockResolvedValue({
        ok: true,
        work: { kind: 'mod', url: registration.url, name: 'demo', version: '2.0.0' },
    });
    fake.register.mockResolvedValue('saved');
});
it.each(['not-found', 'invalid', 'unreachable'])('公開先が%sなら既存のカタログを切り替えない', async (status) => {
    fake.confirm.mockResolvedValue({ status });
    const result = await registerExternalWork({ id: 'alice', handle: 'alice' }, registration, undefined);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'mod-not-published' });
    expect(fake.register).not.toHaveBeenCalled();
});
it('公開先の内容と署名を確認できてから登録を切り替える', async () => {
    fake.confirm.mockResolvedValue({ status: 'published' });
    expect(await registerExternalWork({ id: 'alice', handle: 'alice' }, registration, undefined)).toMatchObject({
        ok: true,
    });
    expect(fake.confirm).toHaveBeenCalledWith(registration, 'alice@example.com');
    expect(fake.register).toHaveBeenCalledOnce();
});
