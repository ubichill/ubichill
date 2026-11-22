import { describe, expect, it } from 'vitest';
import { createConfirmGate } from './confirmGate';

const gateWithLog = () => {
    const shown: Array<string | null> = [];
    return { gate: createConfirmGate((message) => shown.push(message)), shown };
};

/** 答えが出たか（まだ待っているか）を、待たずに確かめる。 */
const settledValue = async (promise: Promise<boolean>): Promise<boolean | 'pending'> =>
    Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0))]);

describe('createConfirmGate', () => {
    it('StrictMode で入室の確認が 2 回来たとき: 1 回目は false で終わり、2 回目が出て「確認」で true になる', async () => {
        const { gate, shown } = gateWithLog();
        const message = 'このワールドは作者の署名を確かめられません。入りますか？';
        const first = gate.ask(message);
        const second = gate.ask(message);
        await expect(first).resolves.toBe(false);
        expect(await settledValue(second)).toBe('pending');

        gate.settle(true);
        await expect(second).resolves.toBe(true);
        expect(shown).toEqual([message, message, null]);
    });

    it('別の確認が来たら、前の確認を閉じて新しい方を出す（戻る操作で前の画面の確認が残らない）', async () => {
        const { gate, shown } = gateWithLog();
        const before = gate.ask('「カフェ」へ移りますか？');
        const after = gate.ask('このワールドに入りますか？');
        await expect(before).resolves.toBe(false);
        gate.settle(false);
        await expect(after).resolves.toBe(false);
        expect(shown).toEqual(['「カフェ」へ移りますか？', 'このワールドに入りますか？', null]);
    });

    it('何度置き換えても、答えを待ったまま残る確認は無い', async () => {
        const { gate } = gateWithLog();
        const asked = ['a', 'b', 'c', 'd'].map((message) => gate.ask(message));
        gate.settle(true);
        await expect(Promise.all(asked)).resolves.toEqual([false, false, false, true]);
    });

    it('答えた後は次の確認を出せる', async () => {
        const { gate, shown } = gateWithLog();
        const first = gate.ask('a');
        gate.settle(false);
        await expect(first).resolves.toBe(false);
        const next = gate.ask('b');
        gate.settle(true);
        await expect(next).resolves.toBe(true);
        expect(shown).toEqual(['a', null, 'b', null]);
    });

    it('続けて答えても（ボタンと Esc）最初の答えだけ。出ていないときの答えは何もしない', async () => {
        const { gate, shown } = gateWithLog();
        gate.settle(true);
        expect(shown).toEqual([]);
        const asked = gate.ask('a');
        gate.settle(false);
        gate.settle(true);
        await expect(asked).resolves.toBe(false);
        expect(shown).toEqual(['a', null]);
    });
});
