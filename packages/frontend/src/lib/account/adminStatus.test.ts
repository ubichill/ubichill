import { afterEach, describe, expect, it, vi } from 'vitest';
import { onAdminRecheck, recheckIfForbidden } from './adminStatus';

// adminApi は読み込むときに API のオリジンを window から決める
vi.stubGlobal('window', { location: { hostname: 'app.example', origin: 'https://app.example' } });
const { deleteRole, fetchRoles, updateRole } = await import('../adminApi');

const respond = (status: number, body: unknown = {}) =>
    vi.fn(
        async () =>
            new Response(status === 204 ? null : JSON.stringify(body), {
                status,
                headers: { 'content-type': 'application/json' },
            }),
    );

describe('管理者かどうかの取り直しの合図', () => {
    afterEach(() => void vi.unstubAllGlobals());

    it('403 のときだけ取り直しを頼む（401・500 では頼まない）', () => {
        const heard = vi.fn();
        const off = onAdminRecheck(heard);
        recheckIfForbidden({ status: 500 });
        recheckIfForbidden({ status: 401 });
        expect(heard).not.toHaveBeenCalled();
        recheckIfForbidden({ status: 403 });
        expect(heard).toHaveBeenCalledTimes(1);
        off();
        recheckIfForbidden({ status: 403 });
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it('管理の API が 403 を返したら取り直しを頼んでから失敗にする（権限が外れた・期限が切れた）', async () => {
        vi.stubGlobal('window', { location: { hostname: 'app.example', origin: 'https://app.example' } });
        vi.stubGlobal('fetch', respond(403, { error: 'Forbidden' }));
        const heard = vi.fn();
        const off = onAdminRecheck(heard);
        await expect(fetchRoles()).rejects.toThrow('Forbidden');
        expect(heard).toHaveBeenCalledTimes(1);
        off();
    });

    it('ロールを変えたら（自分に関わるかもしれない）取り直す。読むだけなら取り直さない', async () => {
        const heard = vi.fn();
        const off = onAdminRecheck(heard);
        vi.stubGlobal('window', { location: { hostname: 'app.example', origin: 'https://app.example' } });
        vi.stubGlobal('fetch', respond(200, { roles: [] }));
        await fetchRoles();
        expect(heard).not.toHaveBeenCalled();
        vi.stubGlobal('window', { location: { hostname: 'app.example', origin: 'https://app.example' } });
        vi.stubGlobal('fetch', respond(204));
        await deleteRole('r1');
        vi.stubGlobal('window', { location: { hostname: 'app.example', origin: 'https://app.example' } });
        vi.stubGlobal('fetch', respond(200, { id: 'r1' }));
        await updateRole('r1', {
            name: 'a',
            description: '',
            color: '#000000',
            isPublic: false,
            isAdministrator: false,
            displayOrder: 0,
        });
        expect(heard).toHaveBeenCalledTimes(2);
        off();
    });
});
