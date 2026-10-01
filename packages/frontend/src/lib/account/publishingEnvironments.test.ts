import { describe, expect, it } from 'vitest';
import type { PublishingEnvironment } from './me';
import {
    isRecentlyAdded,
    isStaleEnvironment,
    RECENTLY_ADDED_MS,
    revokeConfirmMessage,
    STALE_ENVIRONMENT_MS,
    sortEnvironments,
} from './publishingEnvironments';

const NOW = Date.parse('2026-09-29T00:00:00Z');
const env = (overrides: Partial<PublishingEnvironment>): PublishingEnvironment => ({
    id: 'e',
    kind: 'browser',
    name: 'Chrome on Mac',
    publicKey: 'K',
    createdAt: '2026-09-01T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    revokeReason: null,
    ...overrides,
});
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('isStaleEnvironment', () => {
    it('最終利用（未使用なら追加日）から一定期間を超えたら取り消し忘れとして扱う', () => {
        expect(isStaleEnvironment(env({ lastUsedAt: ago(STALE_ENVIRONMENT_MS + 1) }), NOW)).toBe(true);
        expect(isStaleEnvironment(env({ lastUsedAt: ago(STALE_ENVIRONMENT_MS - 1) }), NOW)).toBe(false);
        expect(isStaleEnvironment(env({ createdAt: ago(STALE_ENVIRONMENT_MS + 1) }), NOW)).toBe(true);
    });

    it('古く追加されても最近使っていれば古くない', () => {
        expect(isStaleEnvironment(env({ createdAt: ago(STALE_ENVIRONMENT_MS * 3), lastUsedAt: ago(1000) }), NOW)).toBe(
            false,
        );
    });

    it('取り消し済みは対象外', () => {
        expect(isStaleEnvironment(env({ createdAt: ago(STALE_ENVIRONMENT_MS * 2), revokedAt: ago(1) }), NOW)).toBe(
            false,
        );
    });
});

describe('sortEnvironments', () => {
    it('有効なものを最近使った順に先に、取り消したものを後ろに並べる（元の配列は変えない）', () => {
        const input = [
            env({ id: 'revoked', lastUsedAt: ago(1), revokedAt: ago(1) }),
            env({ id: 'old', lastUsedAt: ago(10_000) }),
            env({ id: 'recent', lastUsedAt: ago(100) }),
            env({ id: 'unused', createdAt: ago(5_000) }),
        ];
        expect(sortEnvironments(input).map((e) => e.id)).toEqual(['recent', 'unused', 'old', 'revoked']);
        expect(input[0]?.id).toBe('revoked');
    });
});

describe('revokeConfirmMessage', () => {
    it('取り消し前の署名も無効になることと、このブラウザなら次の公開で作り直されることを伝える', () => {
        const message = revokeConfirmMessage(env({}), true, 'lost');
        expect(message).toContain('取り消し前のものも含めて');
        expect(message).toContain('自動で追加');
        expect(revokeConfirmMessage(env({}), false, 'lost')).not.toContain('自動で追加');
    });

    it('漏えいとして取り消すときは、署名したワールドをまとめて署名し直さず 1 つずつ確認することを伝える', () => {
        expect(revokeConfirmMessage(env({}), false, 'compromised')).toContain('1 つずつ確認');
        expect(revokeConfirmMessage(env({}), false, 'lost')).not.toContain('1 つずつ確認');
    });
});

describe('isRecentlyAdded（心当たりのない環境に気付けるように）', () => {
    it('追加から一定期間は新しいとして目立たせ、取り消したものは対象外', () => {
        expect(isRecentlyAdded(env({ createdAt: ago(RECENTLY_ADDED_MS - 1) }), NOW)).toBe(true);
        expect(isRecentlyAdded(env({ createdAt: ago(RECENTLY_ADDED_MS + 1) }), NOW)).toBe(false);
        expect(isRecentlyAdded(env({ createdAt: ago(1), revokedAt: ago(0) }), NOW)).toBe(false);
    });
});
