import { describe, expect, it } from 'vitest';
import { type DeleteAccountDeps, deleteAccount } from './deleteAccount';

function setup(overrides: Partial<DeleteAccountDeps> = {}) {
    const log: string[] = [];
    const deps: DeleteAccountDeps = {
        findUser: async (id) =>
            id === 'u1' ? { id, handle: 'alice' } : id === 'root' ? { id, handle: 'ubichill' } : undefined,
        openRooms: async () => ['r1', 'r2'],
        closeRoom: async (roomId) => {
            log.push(`close ${roomId}`);
            return true;
        },
        retire: async (id) => {
            log.push(`retire ${id}`);
            return { status: 'retired', handle: 'alice' };
        },
        afterDeleted: (id) => log.push(`after ${id}`),
        ...overrides,
    };
    return { deps, log };
}

describe('deleteAccount', () => {
    it('部屋を閉じてから消し、後始末をする', async () => {
        const { deps, log } = setup();
        expect(await deleteAccount(deps, { userId: 'u1', confirmHandle: 'alice' })).toEqual({ ok: true });
        expect(log).toEqual(['close r1', 'close r2', 'retire u1', 'after u1']);
    });

    it('ID が違う・入っていないなら何もしない', async () => {
        for (const confirmHandle of ['Alice', 'alice ', '', undefined, ['alice']]) {
            const { deps, log } = setup();
            expect(await deleteAccount(deps, { userId: 'u1', confirmHandle })).toMatchObject({
                ok: false,
                status: 400,
            });
            expect(log).toEqual([]);
        }
    });

    it('公式アカウントは消せない', async () => {
        const { deps, log } = setup();
        expect(await deleteAccount(deps, { userId: 'root', confirmHandle: 'ubichill' })).toMatchObject({ status: 403 });
        expect(log).toEqual([]);
    });

    it('部屋を 1 つでも閉じられなければ消さない（部屋がインスタンスのサーバーに残らないように）', async () => {
        const { deps, log } = setup({
            closeRoom: async (roomId) => {
                log.push(`close ${roomId}`);
                return roomId !== 'r2';
            },
        });
        expect(await deleteAccount(deps, { userId: 'u1', confirmHandle: 'alice' })).toMatchObject({ status: 503 });
        expect(log).toEqual(['close r1', 'close r2']);
    });

    it('いないユーザー・同時に消された場合は 404', async () => {
        expect(await deleteAccount(setup().deps, { userId: 'nobody', confirmHandle: 'x' })).toMatchObject({
            status: 404,
        });
        const { deps } = setup({ retire: async () => ({ status: 'not-found' }) });
        expect(await deleteAccount(deps, { userId: 'u1', confirmHandle: 'alice' })).toMatchObject({ status: 404 });
    });
});
