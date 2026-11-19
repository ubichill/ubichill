import { describe, expect, it } from 'vitest';
import {
    canActAsAdmin,
    isPasswordVerified,
    isRecentlyAuthenticated,
    RECENT_AUTHENTICATION_MS,
    toDateOrNull,
} from './sessionAssurance';

const now = new Date('2026-11-19T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('sessionAssurance', () => {
    it('SSO だけで入ったセッションでは、管理者のユーザーでも管理者の権限を使えない', () => {
        const sso = { createdAt: ago(1000), passwordVerifiedAt: null };
        expect(isPasswordVerified(sso)).toBe(false);
        expect(canActAsAdmin(true, sso)).toBe(false);
        // 古くてもパスワードで入ったセッションなら使える（直近かどうかは問わない）
        expect(canActAsAdmin(true, { createdAt: ago(86_400_000), passwordVerifiedAt: ago(86_400_000) })).toBe(true);
        expect(canActAsAdmin(false, { createdAt: ago(0), passwordVerifiedAt: ago(0) })).toBe(false);
    });

    it('直近はログインか再認証から 10 分（ちょうどは含む）', () => {
        expect(
            isRecentlyAuthenticated({ createdAt: ago(RECENT_AUTHENTICATION_MS), passwordVerifiedAt: null }, now),
        ).toBe(true);
        expect(
            isRecentlyAuthenticated({ createdAt: ago(RECENT_AUTHENTICATION_MS + 1), passwordVerifiedAt: null }, now),
        ).toBe(false);
        // 古いセッションでも、パスワードで再認証した直後は直近
        expect(isRecentlyAuthenticated({ createdAt: ago(86_400_000), passwordVerifiedAt: ago(1000) }, now)).toBe(true);
    });

    it('クッキーキャッシュの文字列の日時も読み、読めないものは null', () => {
        expect(toDateOrNull('2026-11-19T12:00:00.000Z')?.getTime()).toBe(now.getTime());
        expect(toDateOrNull('nope')).toBeNull();
        expect(toDateOrNull(undefined)).toBeNull();
        expect(toDateOrNull(null)).toBeNull();
    });
});
