import { describe, expect, it } from 'vitest';
import { createConfirmGate } from './confirmGate';

const gateWithLog = () => {
    const shown: Array<string | null> = [];
    return { gate: createConfirmGate((message) => shown.push(message)), shown };
};

describe('createConfirmGate', () => {
    it('出ている間に来た確認は出さずに false。先の確認は残り、答えはその確認にだけ返る', async () => {
        const { gate, shown } = gateWithLog();
        const first = gate.ask('「カフェ」へ移りますか？');
        const second = gate.ask('「図書館」へ移りますか？');
        await expect(second).resolves.toBe(false);
        expect(shown).toEqual(['「カフェ」へ移りますか？']);

        gate.settle(true);
        await expect(first).resolves.toBe(true);
        expect(shown).toEqual(['「カフェ」へ移りますか？', null]);
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
