import { afterEach, describe, expect, it, vi } from 'vitest';

const required = {
    DATABASE_URL: 'postgres://localhost/test',
    BETTER_AUTH_SECRET: 'test-secret',
    INSTANCE_ADMIN_TOKEN: 'a'.repeat(32),
};

const load = async (env: Record<string, string>) => {
    vi.resetModules();
    for (const [key, value] of Object.entries({ ...required, ...env })) vi.stubEnv(key, value);
    return import('./index');
};

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('WORLDS_SERVE_UNSIGNED_REPOSITORY', () => {
    it('本番では起動させない（署名の無いワールドを公式として配ってしまう）', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(load({ NODE_ENV: 'production', WORLDS_SERVE_UNSIGNED_REPOSITORY: 'true' })).rejects.toThrow();
    });

    it('開発では使える', async () => {
        await expect(
            load({ NODE_ENV: 'development', WORLDS_SERVE_UNSIGNED_REPOSITORY: 'true' }),
        ).resolves.toBeDefined();
    });

    it('本番でも未指定なら起動する', async () => {
        await expect(load({ NODE_ENV: 'production' })).resolves.toBeDefined();
    });
});
