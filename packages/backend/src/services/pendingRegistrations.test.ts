import { describe, expect, it } from 'vitest';
import { createPendingRegistrationStore, type PendingRegistration } from './pendingRegistrations';

const limits = { ttlMs: 1000, maxPerEmail: 2, maxFailures: 3 };

function setup() {
    const clock = { now: 0 };
    const counter = { id: 0, otp: 0 };
    const store = createPendingRegistrationStore({
        now: () => clock.now,
        newId: () => `id-${++counter.id}`,
        newOtp: () => String(100000 + ++counter.otp),
        limits,
    });
    return { store, clock };
}

const registration = (overrides: Partial<PendingRegistration> = {}): PendingRegistration => ({
    email: 'victim@example.com',
    password: 'victim-password',
    displayName: 'Victim',
    handle: 'victim',
    ...overrides,
});

const added = (result: ReturnType<ReturnType<typeof setup>['store']['add']>) => {
    if ('error' in result) throw new Error(result.error);
    return result;
};

describe('仮登録', () => {
    it('申し込んだ本人の ID とコードで本登録の内容を取り出せ、取り出したら消える', () => {
        const { store } = setup();
        const { id, otp } = added(store.add(registration()));
        expect(store.verify(id, otp)).toEqual({ status: 'verified', registration: registration() });
        expect(store.verify(id, otp)).toEqual({ status: 'not-found' });
    });

    it('他人が同じメールアドレスで申し込み直しても、本人の仮登録のパスワードは置き換わらない', () => {
        const { store } = setup();
        const victim = added(store.add(registration()));
        const attacker = added(store.add(registration({ password: 'attacker-password', handle: 'attacker' })));

        // 本人は自分に届いたコードを自分の画面で入れる
        expect(store.verify(victim.id, victim.otp)).toMatchObject({
            status: 'verified',
            registration: { password: 'victim-password', handle: 'victim' },
        });
        // 攻撃者は本人宛てのコードを知らないので完了できない
        expect(store.verify(attacker.id, victim.otp)).toEqual({ status: 'wrong-code' });
    });

    it('他人のコードを自分の ID で使うことはできない', () => {
        const { store } = setup();
        const a = added(store.add(registration({ email: 'a@example.com' })));
        const b = added(store.add(registration({ email: 'b@example.com' })));
        expect(store.verify(a.id, b.otp)).toEqual({ status: 'wrong-code' });
    });

    it('コードを決められた回数間違えたら仮登録を捨て、正しいコードでも完了できない', () => {
        const { store } = setup();
        const { id, otp } = added(store.add(registration()));
        expect(store.verify(id, '000000')).toEqual({ status: 'wrong-code' });
        expect(store.verify(id, '000001')).toEqual({ status: 'wrong-code' });
        expect(store.verify(id, '000002')).toEqual({ status: 'too-many-failures' });
        expect(store.verify(id, otp)).toEqual({ status: 'not-found' });
    });

    it('再送信しても間違えた回数は戻らない（再送信を挟んで総当たりを続けられない）', () => {
        const { store } = setup();
        const { id } = added(store.add(registration()));
        store.verify(id, '000000');
        store.verify(id, '000001');
        const reissued = store.reissue(id);
        expect(reissued?.otp).toBeDefined();
        expect(store.verify(id, '000002')).toEqual({ status: 'too-many-failures' });
    });

    it('再送信すると古いコードは使えなくなる', () => {
        const { store } = setup();
        const { id, otp } = added(store.add(registration()));
        const reissued = store.reissue(id);
        expect(store.verify(id, otp)).toEqual({ status: 'wrong-code' });
        expect(store.verify(id, reissued?.otp ?? '')).toMatchObject({ status: 'verified' });
    });

    it('期限を過ぎたら完了も再送信もできない', () => {
        const { store, clock } = setup();
        const { id, otp } = added(store.add(registration()));
        clock.now = limits.ttlMs;
        expect(store.reissue(id)).toBeUndefined();
        expect(store.verify(id, otp)).toEqual({ status: 'expired' });
    });

    it('同じメールアドレスへの仮登録は上限まで（確認メールを大量に送らせない）。期限が切れれば枠は空く', () => {
        const { store, clock } = setup();
        added(store.add(registration()));
        added(store.add(registration()));
        expect(store.add(registration())).toEqual({ error: 'too-many-pending' });
        expect('id' in store.add(registration({ email: 'other@example.com' }))).toBe(true);
        clock.now = limits.ttlMs;
        expect('id' in store.add(registration())).toBe(true);
    });

    it('本登録に失敗して戻した仮登録は、同じコードでやり直せる', () => {
        const { store } = setup();
        const { id, otp } = added(store.add(registration()));
        const outcome = store.verify(id, otp);
        if (outcome.status !== 'verified') throw new Error('verified のはず');
        store.restore(id, outcome.registration, otp);
        expect(store.verify(id, otp)).toMatchObject({ status: 'verified' });
    });
});
