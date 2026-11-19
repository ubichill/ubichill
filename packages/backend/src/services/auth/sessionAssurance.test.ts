import { describe, expect, it } from 'vitest';
import {
    canActAsAdmin,
    isPasswordVerified,
    isRecentlyAuthenticated,
    isStrongSession,
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

    it('パスワードの無い人の直近は、ログインから 10 分（ちょうどは含む）', () => {
        const at = (ms: number) => ({ createdAt: ago(ms), passwordVerifiedAt: null });
        expect(isRecentlyAuthenticated(at(RECENT_AUTHENTICATION_MS), now, false)).toBe(true);
        expect(isRecentlyAuthenticated(at(RECENT_AUTHENTICATION_MS + 1), now, false)).toBe(false);
    });

    it('パスワードを持つ人は、SSO で入った直後でもパスワードを確かめるまで直近でない', () => {
        expect(isRecentlyAuthenticated({ createdAt: ago(1000), passwordVerifiedAt: null }, now, true)).toBe(false);
        // 古いセッションでも、パスワードで再認証した直後は直近
        const reauthed = { createdAt: ago(86_400_000), passwordVerifiedAt: ago(1000) };
        expect(isRecentlyAuthenticated(reauthed, now, true)).toBe(true);
        expect(
            isRecentlyAuthenticated({ ...reauthed, passwordVerifiedAt: ago(RECENT_AUTHENTICATION_MS + 1) }, now, true),
        ).toBe(false);
    });

    it('パスワードを持つ人の SSO のセッションは、アカウントの安全に関わる操作に使えない', () => {
        const sso = { createdAt: ago(1000), passwordVerifiedAt: null };
        expect(isStrongSession(sso, true)).toBe(false);
        expect(isStrongSession(sso, false)).toBe(true);
        expect(isStrongSession({ createdAt: ago(86_400_000), passwordVerifiedAt: ago(86_400_000) }, true)).toBe(true);
    });

    it('クッキーキャッシュの文字列の日時も読み、読めないものは null', () => {
        expect(toDateOrNull('2026-11-19T12:00:00.000Z')?.getTime()).toBe(now.getTime());
        expect(toDateOrNull('nope')).toBeNull();
        expect(toDateOrNull(undefined)).toBeNull();
        expect(toDateOrNull(null)).toBeNull();
    });
});
