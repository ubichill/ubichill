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

describe('INSTANCE_CREATE_LIMIT_PER_HOUR', () => {
    it('未指定なら本番も開発も 1 IP・1 時間あたり 10 件（既定は変わらない）', async () => {
        const production = await load({ NODE_ENV: 'production' });
        expect(production.INSTANCE_CREATE_LIMIT_DEFAULT).toBe(10);
        expect(production.appConfig.rateLimit.instanceCreatePerHour).toBe(10);
        const development = await load({ NODE_ENV: 'development' });
        expect(development.appConfig.rateLimit.instanceCreatePerHour).toBe(10);
    });

    it('空文字は未指定と同じ（chart の空の値）', async () => {
        const { appConfig } = await load({ NODE_ENV: 'production', INSTANCE_CREATE_LIMIT_PER_HOUR: '' });
        expect(appConfig.rateLimit.instanceCreatePerHour).toBe(10);
    });

    it('開発では負荷試験のために上げられる', async () => {
        const { appConfig } = await load({ NODE_ENV: 'development', INSTANCE_CREATE_LIMIT_PER_HOUR: '5000' });
        expect(appConfig.rateLimit.instanceCreatePerHour).toBe(5000);
    });

    it('本番では既定より 1 件でも緩めると起動しない', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(load({ NODE_ENV: 'production', INSTANCE_CREATE_LIMIT_PER_HOUR: '11' })).rejects.toThrow();
    });

    it('本番でも既定以下に絞るのはよい', async () => {
        const { appConfig } = await load({ NODE_ENV: 'production', INSTANCE_CREATE_LIMIT_PER_HOUR: '3' });
        expect(appConfig.rateLimit.instanceCreatePerHour).toBe(3);
    });

    it.each(['0', '-1', '1.5', 'many', 'Infinity'])('%s は受け付けない（「上限なし」にさせない）', async (value) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(load({ NODE_ENV: 'development', INSTANCE_CREATE_LIMIT_PER_HOUR: value })).rejects.toThrow();
    });
});
