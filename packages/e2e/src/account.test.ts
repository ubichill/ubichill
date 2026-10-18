import { describe, expect, it } from 'vitest';
import { newRunId, SMOKE_MARK, smokeAccount } from './account.ts';

const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

describe('smokeAccount', () => {
    it('ID・表示名・メールアドレスのどれも印で始まる', () => {
        const account = smokeAccount('abc123', 'a');
        expect(account.handle.startsWith(`${SMOKE_MARK}_`)).toBe(true);
        expect(account.displayName.startsWith(SMOKE_MARK)).toBe(true);
        expect(account.email.startsWith(SMOKE_MARK)).toBe(true);
        expect(account.handle).toMatch(HANDLE_PATTERN);
        expect(account.password.length).toBeGreaterThanOrEqual(8);
    });

    it('同じ走りの 2 人は ID・表示名・メールアドレスが重ならない（どれも一意の制約がある）', () => {
        const a = smokeAccount('abc123', 'a');
        const b = smokeAccount('abc123', 'b');
        expect(a.handle).not.toBe(b.handle);
        expect(a.displayName).not.toBe(b.displayName);
        expect(a.email).not.toBe(b.email);
    });

    it('大文字は小文字にする（ID は英小文字だけ）', () => {
        expect(smokeAccount('ABC', 'A').handle).toBe('smoke_abc_a');
    });

    it('ID に使えない文字は断る', () => {
        expect(() => smokeAccount('ab-c', 'a')).toThrow();
        expect(() => smokeAccount('abc', 'ä')).toThrow();
    });

    it('ID が 30 文字を超えるなら断る（登録で弾かれる前に）', () => {
        expect(() => smokeAccount('x'.repeat(30), 'a')).toThrow(/30/);
    });
});

describe('newRunId', () => {
    it('乱数が端（0 と 1 の手前）でも、ID に使える 10 文字になる', () => {
        for (const random of [0, 0.999999999]) {
            const id = newRunId(Date.UTC(2026, 9, 18), () => random);
            expect(id).toMatch(/^[a-z0-9]{10}$/);
            expect(smokeAccount(id, 'w').handle).toMatch(HANDLE_PATTERN);
        }
    });

    it('同じ時刻でも乱数が違えば別の ID', () => {
        const now = Date.UTC(2026, 9, 18);
        expect(newRunId(now, () => 0.1)).not.toBe(newRunId(now, () => 0.2));
    });
});
