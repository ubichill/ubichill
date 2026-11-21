import type { AccountSessionRecord } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import { accountSessionView } from './accountSessions';

const record = (overrides: Partial<AccountSessionRecord> = {}): AccountSessionRecord => ({
    id: 's1',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    ipAddress: '203.0.113.1',
    userAgent: 'Mozilla/5.0',
    passwordVerifiedAt: null,
    authProviderId: null,
    authUsername: null,
    ...overrides,
});

describe('ログイン中の端末の見せ方', () => {
    it('SSO で入ったものは外部アカウント、パスワードで確かめたものはパスワード、どちらでもなければ不明', () => {
        expect(
            accountSessionView(record({ authProviderId: 'fediverse:https://misskey.io', authUsername: 'alice' }), 'x')
                .via,
        ).toEqual({ kind: 'fediverse', account: '@alice@misskey.io' });
        // SSO の後にパスワードで本人確認したセッションも、入った方法は SSO
        expect(
            accountSessionView(
                record({ authProviderId: 'fediverse:https://mstdn.jp', passwordVerifiedAt: new Date() }),
                'x',
            ).via,
        ).toEqual({ kind: 'fediverse', account: 'mstdn.jp' });
        expect(accountSessionView(record({ passwordVerifiedAt: new Date() }), 'x').via).toEqual({ kind: 'password' });
        expect(accountSessionView(record(), 'x').via).toBeNull();
    });

    it('今の端末に印を付け、最後に使った時刻を出す。長すぎる User-Agent は切る', () => {
        const view = accountSessionView(record({ userAgent: 'x'.repeat(1000) }), 's1');
        expect(view.current).toBe(true);
        expect(view.lastActiveAt).toBe('2026-11-02T00:00:00.000Z');
        expect(view.userAgent).toHaveLength(300);
        expect(Object.keys(view)).not.toContain('token');
    });
});
