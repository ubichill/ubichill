import type { TwoFactorChallengeRecord } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import {
    CHALLENGE_ATTEMPTS,
    CHALLENGE_TTL_MS,
    type ChallengeOutcome,
    createTwoFactorChallenges,
    type FirstFactor,
} from './challenges';
import type { CodeCheck } from './twoFactor';

function setup(verify: (userId: string, code: unknown) => Promise<CodeCheck>) {
    const rows = new Map<string, TwoFactorChallengeRecord>();
    const clock = { now: new Date('2026-11-21T00:00:00Z') };
    const tokens = { next: 0 };
    const challenges = createTwoFactorChallenges({
        repository: {
            create: async (record) => {
                rows.set(record.id, { ...record, attempts: 0 });
            },
            beginAttempt: async (id, now, max) => {
                const row = rows.get(id);
                if (!row || row.expiresAt <= now || row.attempts >= max) return undefined;
                row.attempts += 1;
                return { ...row };
            },
            consume: async (id, now) => {
                const row = rows.get(id);
                if (!row || row.expiresAt <= now) return undefined;
                rows.delete(id);
                return row;
            },
            remove: async (id) => {
                rows.delete(id);
            },
        },
        verify,
        newToken: () => `token-${++tokens.next}`,
        hashToken: (token) => `hash(${token})`,
        now: () => clock.now,
        lockedError: 'しばらく使えません',
    });
    return { challenges, rows, clock };
}

const ok: CodeCheck = { ok: true, via: 'totp', backupCodesLeft: 10 };
const first: FirstFactor = {
    userId: 'alice',
    passwordVerified: false,
    authAccountId: 'acc-1',
    remember: true,
    returnTo: '/@bob/room',
};
const byCode = async (_userId: string, code: unknown): Promise<CodeCheck> =>
    code === '123456' ? ok : { ok: false, reason: 'invalid-code' };

describe('ログインの二段階目の途中', () => {
    it('発行した乱数はハッシュだけを置き、正しいコードで一段階目の情報を返して使い切る', async () => {
        const t = setup(byCode);
        const token = await t.challenges.issue(first);
        expect(t.rows.has(token)).toBe(false);
        expect(t.rows.get(`hash(${token})`)).toMatchObject({ userId: 'alice', attempts: 0 });

        expect(await t.challenges.complete(token, '123456')).toEqual({ ok: true, ...first });
        expect(t.rows.size).toBe(0);
        expect(await t.challenges.complete(token, '123456')).toMatchObject({ ok: false, error: 'challenge-expired' });
    });

    it('間違えたら同じ途中でやり直せるが、5 回目で捨てる', async () => {
        const t = setup(byCode);
        const token = await t.challenges.issue(first);
        // 1 回ずつ順に送る
        const results = await Array.from({ length: CHALLENGE_ATTEMPTS }).reduce<Promise<ChallengeOutcome[]>>(
            async (done) => [...(await done), await t.challenges.complete(token, '000000')],
            Promise.resolve([]),
        );
        expect(results.slice(0, -1).every((r) => !r.ok && r.error === 'invalid-code')).toBe(true);
        expect(results.at(-1)).toMatchObject({ ok: false, error: 'challenge-expired' });
        expect(await t.challenges.complete(token, '123456')).toMatchObject({ ok: false, error: 'challenge-expired' });
    });

    it('同時に送っても、試せるのは 5 回まで（数えてから確かめる）', async () => {
        const seen: unknown[] = [];
        const t = setup(async (userId, code) => {
            seen.push(code);
            return byCode(userId, code);
        });
        const token = await t.challenges.issue(first);
        await Promise.all(Array.from({ length: 20 }, () => t.challenges.complete(token, '000000')));
        expect(seen).toHaveLength(CHALLENGE_ATTEMPTS);
    });

    it('10 分を過ぎた途中は使えない', async () => {
        const t = setup(byCode);
        const token = await t.challenges.issue(first);
        t.clock.now = new Date(t.clock.now.getTime() + CHALLENGE_TTL_MS + 1);
        expect(await t.challenges.complete(token, '123456')).toMatchObject({ ok: false, error: 'challenge-expired' });
    });

    it('途中が無い・知らない乱数なら最初からやり直させる', async () => {
        const t = setup(byCode);
        await t.challenges.issue(first);
        expect(await t.challenges.complete(null, '123456')).toMatchObject({ error: 'challenge-expired' });
        expect(await t.challenges.complete('forged', '123456')).toMatchObject({ error: 'challenge-expired' });
    });

    it('止められている（続けて間違えた）なら途中を捨てて知らせる', async () => {
        const t = setup(async () => ({ ok: false, reason: 'locked' }));
        const token = await t.challenges.issue(first);
        expect(await t.challenges.complete(token, '123456')).toEqual({
            ok: false,
            error: 'locked',
            message: 'しばらく使えません',
        });
        expect(t.rows.size).toBe(0);
    });

    it('途中で二段階認証が外されたら、ログインし直させる（二段階目なしで入れる）', async () => {
        const t = setup(async () => ({ ok: false, reason: 'not-enabled' }));
        const token = await t.challenges.issue(first);
        expect(await t.challenges.complete(token, '123456')).toMatchObject({ ok: false, error: 'challenge-expired' });
        expect(t.rows.size).toBe(0);
    });

    it('同時に正しいコードで通っても、セッションを作れるのは 1 つだけ', async () => {
        const t = setup(byCode);
        const token = await t.challenges.issue(first);
        const results = await Promise.all([
            t.challenges.complete(token, '123456'),
            t.challenges.complete(token, '123456'),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
    });
});
