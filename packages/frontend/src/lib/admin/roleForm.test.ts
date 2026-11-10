import type { Role } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    assignableRoles,
    draftOf,
    EXPIRY_PRESETS,
    expiresAtOf,
    expiryLabel,
    isExpiryPreset,
    NEW_ROLE_DRAFT,
    roleInputOf,
} from './roleForm';

const role = (id: string, patch: Partial<Role> = {}): Role => ({
    id,
    name: id,
    color: '#123456',
    description: null,
    isPublic: true,
    isAdministrator: true,
    displayOrder: 3,
    memberCount: 0,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...patch,
});

describe('ロールの下書き', () => {
    it('新しいロールは非公開・管理者でない（付けるときに選ぶ）', () => {
        expect(NEW_ROLE_DRAFT).toMatchObject({ isPublic: false, isAdministrator: false });
        // 名前が空のままでは作れない
        expect(roleInputOf(NEW_ROLE_DRAFT).ok).toBe(false);
    });

    it('保存済みのロールから作った下書きは、そのまま保存できる', () => {
        const result = roleInputOf(draftOf(role('a', { description: null })));
        expect(result).toEqual({
            ok: true,
            input: {
                name: 'a',
                description: '',
                color: '#123456',
                isPublic: true,
                isAdministrator: true,
                displayOrder: 3,
            },
        });
    });

    it('表示順は 0 以上の整数の文字だけ（空・小数・指数・負・全角は通さない）', () => {
        const withOrder = (displayOrder: string) => roleInputOf({ ...NEW_ROLE_DRAFT, name: 'a', displayOrder });
        expect(withOrder(' 12 ')).toMatchObject({ ok: true, input: { displayOrder: 12 } });
        for (const bad of ['', ' ', '1.5', '1e2', '-1', '１２', '1000', '0x10']) {
            expect(withOrder(bad), bad).toEqual({ ok: false, error: '表示順は 0〜999 の整数です' });
        }
    });

    it('通らない理由はサーバーと同じ文で返す', () => {
        expect(roleInputOf({ ...NEW_ROLE_DRAFT, name: 'a', color: 'red' })).toEqual({
            ok: false,
            error: '色は #rrggbb の形で指定してください',
        });
        expect(roleInputOf({ ...NEW_ROLE_DRAFT, name: '   ' })).toEqual({
            ok: false,
            error: 'ロールの名前を入れてください',
        });
    });
});

describe('アサインの期限', () => {
    const now = new Date('2026-11-10T00:00:00.000Z');

    it('無期限は null、ほかはいまから足した時刻', () => {
        expect(expiresAtOf('none', now)).toBeNull();
        expect(expiresAtOf('1d', now)).toBe('2026-11-11T00:00:00.000Z');
        expect(expiresAtOf('30d', now)).toBe('2026-12-10T00:00:00.000Z');
        // どの期限もいまより後（サーバーが受け付ける）
        for (const p of EXPIRY_PRESETS) {
            const at = expiresAtOf(p.id, now);
            if (at !== null) expect(new Date(at).getTime()).toBeGreaterThan(now.getTime());
        }
    });

    it('選択肢にない値は期限として扱わない', () => {
        expect(isExpiryPreset('7d')).toBe(true);
        expect(isExpiryPreset('forever')).toBe(false);
        expect(isExpiryPreset('')).toBe(false);
    });

    it('表示: 無期限と、期限の日時まで', () => {
        expect(expiryLabel(null)).toBe('無期限');
        expect(expiryLabel('2026-12-01T00:00:00.000Z')).toMatch(/まで$/);
    });
});

describe('assignableRoles', () => {
    it('付いているロールを除き、並びは変えない', () => {
        const roles = [role('c'), role('a'), role('b')];
        expect(assignableRoles(roles, [{ id: 'a' }]).map((r) => r.id)).toEqual(['c', 'b']);
        expect(assignableRoles(roles, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual([]);
        expect(assignableRoles([], [{ id: 'a' }])).toEqual([]);
    });
});
