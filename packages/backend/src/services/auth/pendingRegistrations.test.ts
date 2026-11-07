import type { NewCredentialUser, PendingRegistrationRecord } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import {
    createOtpHasher,
    createPendingRegistrations,
    hashRegistrationId,
    judgeVerification,
    type PendingRegistrationInput,
    type PendingRegistrationRepository,
} from './pendingRegistrations';

const limits = { ttlMs: 1000, maxPerEmail: 2, maxFailures: 3 };

/** Postgres の代わり。トランザクションは「投げたら中の変更を戻す」だけを真似る。 */
function fakeRepository() {
    const rows = new Map<string, PendingRegistrationRecord>();
    const created: NewCredentialUser[] = [];
    const failNextCreate = { value: false };

    const transaction = async <T>(fn: () => Promise<T>): Promise<T> => {
        const rowsBefore = new Map([...rows].map(([k, v]) => [k, { ...v }]));
        const createdBefore = created.length;
        try {
            return await fn();
        } catch (error) {
            rows.clear();
            for (const [k, v] of rowsBefore) rows.set(k, v);
            created.length = createdBefore;
            throw error;
        }
    };

    const repository: PendingRegistrationRepository = {
        withEmailLock: (email, fn) =>
            transaction(() =>
                fn({
                    countActive: async (now) =>
                        [...rows.values()].filter((r) => r.email === email && r.expiresAt > now).length,
                    insert: async (record) => {
                        rows.set(record.idHash, { ...record });
                    },
                }),
            ),
        withLockedRegistration: (idHash, fn) =>
            transaction(() => {
                const record = rows.get(idHash);
                return fn(record && { ...record }, {
                    remove: async () => {
                        rows.delete(idHash);
                    },
                    setFailures: async (failures) => {
                        const row = rows.get(idHash);
                        if (row) rows.set(idHash, { ...row, failures });
                    },
                    createCredentialUser: async (user) => {
                        created.push(user);
                        if (failNextCreate.value) {
                            failNextCreate.value = false;
                            throw new Error('duplicate key value violates unique constraint "users_handle_unique"');
                        }
                    },
                });
            }),
        reissue: async (idHash, otpHash, expiresAt, now) => {
            const row = rows.get(idHash);
            if (!row || row.expiresAt <= now) return undefined;
            rows.set(idHash, { ...row, otpHash, expiresAt });
            return { email: row.email, displayName: row.displayName };
        },
        remove: async (idHash) => {
            rows.delete(idHash);
        },
    };
    return { repository, rows, created, failNextCreate };
}

function setup() {
    const clock = { now: 0 };
    const counter = { id: 0, otp: 0, record: 0 };
    const fake = fakeRepository();
    const store = createPendingRegistrations({
        repository: fake.repository,
        now: () => new Date(clock.now),
        newId: () => `id-${++counter.id}`,
        newOtp: () => String(100000 + ++counter.otp),
        hashOtp: createOtpHasher('test-secret'),
        newRecordId: (model) => `${model}-${++counter.record}`,
        limits,
    });
    return { store, clock, ...fake };
}

const registration = (overrides: Partial<PendingRegistrationInput> = {}): PendingRegistrationInput => ({
    email: 'victim@example.com',
    passwordHash: 'hash-of-victim-password',
    displayName: 'Victim',
    handle: 'victim',
    ...overrides,
});

const added = async (result: Promise<{ id: string; otp: string } | { error: 'too-many-pending' }>) => {
    const value = await result;
    if ('error' in value) throw new Error(value.error);
    return value;
};

describe('仮登録', () => {
    it('申し込んだ本人の ID とコードで本登録され、仮登録は消える', async () => {
        const { store, created, rows } = setup();
        const { id, otp } = await added(store.add(registration()));
        expect(await store.verify(id, otp)).toMatchObject({ status: 'verified', email: 'victim@example.com' });
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({
            email: 'victim@example.com',
            name: 'Victim',
            handle: 'victim',
            displayNameKey: 'victim',
            passwordHash: 'hash-of-victim-password',
        });
        expect(created[0]?.userId).not.toBe(created[0]?.accountId);
        expect(rows.size).toBe(0);
        expect(await store.verify(id, otp)).toEqual({ status: 'not-found' });
    });

    it('登録 ID・コードの平文は保存せず、同じコードでも仮登録ごとにハッシュが違う', async () => {
        const { store, rows } = setup();
        const a = await added(store.add(registration()));
        const b = await added(store.add(registration({ email: 'other@example.com' })));
        const stored = JSON.stringify([...rows.values()]);
        for (const secret of [a.id, a.otp, b.id, b.otp]) expect(stored).not.toContain(secret);
        expect(rows.has(hashRegistrationId(a.id))).toBe(true);
        const hash = createOtpHasher('test-secret');
        expect(hash(hashRegistrationId(a.id), '123456')).not.toBe(hash(hashRegistrationId(b.id), '123456'));
        expect(createOtpHasher('other-secret')(hashRegistrationId(a.id), a.otp)).not.toBe(
            rows.get(hashRegistrationId(a.id))?.otpHash,
        );
    });

    it('他人が同じメールアドレスで申し込み直しても、本人の仮登録のパスワードは置き換わらない', async () => {
        const { store, created } = setup();
        const victim = await added(store.add(registration()));
        const attacker = await added(
            store.add(registration({ passwordHash: 'hash-of-attacker-password', handle: 'attacker' })),
        );

        // 攻撃者は本人宛てのコードを知らないので完了できない
        expect(await store.verify(attacker.id, victim.otp)).toEqual({ status: 'wrong-code' });
        // 本人は自分に届いたコードを自分の画面で入れる
        expect(await store.verify(victim.id, victim.otp)).toMatchObject({ status: 'verified' });
        expect(created).toEqual([
            expect.objectContaining({ passwordHash: 'hash-of-victim-password', handle: 'victim' }),
        ]);
    });

    it('他人のコードを自分の ID で使うことはできない', async () => {
        const { store } = setup();
        const a = await added(store.add(registration({ email: 'a@example.com' })));
        const b = await added(store.add(registration({ email: 'b@example.com' })));
        expect(await store.verify(a.id, b.otp)).toEqual({ status: 'wrong-code' });
    });

    it('コードを決められた回数間違えたら仮登録を捨て、正しいコードでも完了できない', async () => {
        const { store, rows } = setup();
        const { id, otp } = await added(store.add(registration()));
        expect(await store.verify(id, '000000')).toEqual({ status: 'wrong-code' });
        expect(await store.verify(id, '000001')).toEqual({ status: 'wrong-code' });
        expect(await store.verify(id, '000002')).toEqual({ status: 'too-many-failures' });
        expect(rows.size).toBe(0);
        expect(await store.verify(id, otp)).toEqual({ status: 'not-found' });
    });

    it('再送信しても間違えた回数は戻らない（再送信を挟んで総当たりを続けられない）', async () => {
        const { store } = setup();
        const { id } = await added(store.add(registration()));
        await store.verify(id, '000000');
        await store.verify(id, '000001');
        const reissued = await store.reissue(id);
        expect(reissued?.otp).toBeDefined();
        expect(await store.verify(id, '000002')).toEqual({ status: 'too-many-failures' });
        expect(await store.verify(id, reissued?.otp ?? '')).toEqual({ status: 'not-found' });
    });

    it('再送信すると古いコードは使えなくなる', async () => {
        const { store } = setup();
        const { id, otp } = await added(store.add(registration()));
        const reissued = await store.reissue(id);
        expect(reissued).toMatchObject({ email: 'victim@example.com', displayName: 'Victim' });
        expect(await store.verify(id, otp)).toEqual({ status: 'wrong-code' });
        expect(await store.verify(id, reissued?.otp ?? '')).toMatchObject({ status: 'verified' });
    });

    it('期限を過ぎたら完了も再送信もできず、確かめた時点で消える', async () => {
        const { store, clock, rows } = setup();
        const { id, otp } = await added(store.add(registration()));
        clock.now = limits.ttlMs;
        expect(await store.reissue(id)).toBeUndefined();
        expect(await store.verify(id, otp)).toEqual({ status: 'expired' });
        expect(rows.size).toBe(0);
    });

    it('再送信で期限が延びる', async () => {
        const { store, clock } = setup();
        const { id } = await added(store.add(registration()));
        clock.now = limits.ttlMs - 1;
        const reissued = await store.reissue(id);
        clock.now = limits.ttlMs + 1;
        expect(await store.verify(id, reissued?.otp ?? '')).toMatchObject({ status: 'verified' });
    });

    it('同じメールアドレスへの仮登録は上限まで（大文字小文字は同じアドレス）。期限が切れれば枠は空く', async () => {
        const { store, clock, rows } = setup();
        await added(store.add(registration()));
        await added(store.add(registration({ email: 'Victim@Example.COM' })));
        expect(await store.add(registration())).toEqual({ error: 'too-many-pending' });
        expect(await store.add(registration({ email: 'VICTIM@example.com' }))).toEqual({ error: 'too-many-pending' });
        expect('id' in (await store.add(registration({ email: 'other@example.com' })))).toBe(true);
        expect([...rows.values()].every((r) => r.email === r.email.toLowerCase())).toBe(true);
        clock.now = limits.ttlMs;
        expect('id' in (await store.add(registration()))).toBe(true);
    });

    it('本登録に失敗したら仮登録は残り（失敗回数も増えない）、同じコードでやり直せる', async () => {
        const { store, rows, created, failNextCreate } = setup();
        const { id, otp } = await added(store.add(registration()));
        failNextCreate.value = true;
        expect(await store.verify(id, otp)).toMatchObject({ status: 'register-failed' });
        expect(created).toHaveLength(0);
        expect(rows.get(hashRegistrationId(id))?.failures).toBe(0);
        expect(await store.verify(id, otp)).toMatchObject({ status: 'verified' });
        expect(created).toHaveLength(1);
    });

    it('取り消した仮登録は使えない', async () => {
        const { store } = setup();
        const { id, otp } = await added(store.add(registration()));
        await store.remove(id);
        expect(await store.verify(id, otp)).toEqual({ status: 'not-found' });
        expect(await store.reissue(id)).toBeUndefined();
    });
});

describe('judgeVerification', () => {
    const record = { otpHash: 'right', failures: 0, expiresAt: new Date(1000) };

    it('期限ちょうどは期限切れ（コードが合っていても）', () => {
        expect(judgeVerification(record, 'right', new Date(1000), limits)).toEqual({ status: 'expired' });
        expect(judgeVerification(record, 'right', new Date(999), limits)).toMatchObject({ status: 'verified' });
    });

    it('長さの違うハッシュは一致しない（例外にならない）', () => {
        expect(judgeVerification(record, 'righ', new Date(0), limits)).toEqual({ status: 'wrong-code', failures: 1 });
        expect(judgeVerification(record, '', new Date(0), limits)).toEqual({ status: 'wrong-code', failures: 1 });
    });

    it('上限の 1 つ手前までは wrong-code、上限に達したら too-many-failures', () => {
        expect(judgeVerification({ ...record, failures: 1 }, 'x', new Date(0), limits)).toEqual({
            status: 'wrong-code',
            failures: 2,
        });
        expect(judgeVerification({ ...record, failures: 2 }, 'x', new Date(0), limits)).toEqual({
            status: 'too-many-failures',
        });
    });
});
