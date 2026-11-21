import { DEFAULT_SERVER_INFO, type ServerInfo } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createServerInfo } from './serverInfo';

function setup(initial: (ServerInfo & { updatedAt: Date }) | null = null) {
    const store = { row: initial };
    const service = createServerInfo({
        repository: {
            get: async () => store.row,
            put: async (info) => {
                store.row = { ...info, updatedAt: new Date('2026-11-21T00:00:00Z') };
            },
        },
        countPeople: async () => 12,
        registrationOpen: true,
    });
    return { service, store };
}

describe('createServerInfo', () => {
    it('保存していなければ既定の値を返す', async () => {
        const { service } = setup();
        expect(await service.settings()).toEqual({ info: DEFAULT_SERVER_INFO, updatedAt: null });
        expect(await service.overview()).toEqual({
            info: DEFAULT_SERVER_INFO,
            registrationOpen: true,
            stats: { users: 12 },
        });
    });

    it('整えてから保存し、保存した後の設定を返す', async () => {
        const { service, store } = setup();
        const outcome = await service.update({
            ...DEFAULT_SERVER_INFO,
            name: ' ようかんの Ubichill ',
            description: '',
            tosUrl: 'https://example.com/tos',
        });
        expect(outcome).toEqual({
            ok: true,
            value: {
                info: { ...DEFAULT_SERVER_INFO, name: 'ようかんの Ubichill', tosUrl: 'https://example.com/tos' },
                updatedAt: '2026-11-21T00:00:00.000Z',
            },
        });
        expect(store.row?.description).toBeNull();
    });

    it('正しくない入力は保存しない', async () => {
        const { service, store } = setup();
        expect(await service.update({ ...DEFAULT_SERVER_INFO, inquiryUrl: 'javascript:alert(1)' })).toEqual({
            ok: false,
            status: 400,
            error: '問い合わせ先の URL には http(s) の URL を入れてください',
        });
        expect(await service.update({ name: 'x' })).toMatchObject({ ok: false, status: 400 });
        expect(store.row).toBeNull();
    });
});
