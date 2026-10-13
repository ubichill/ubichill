import { describe, expect, it } from 'vitest';
import {
    CommandType,
    HostEventType,
    InputEventType,
    MIN_COMPATIBLE_PROTOCOL_VERSION,
    PROTOCOL_VERSION,
} from './protocol';
import { PROTOCOL_CONTRACTS, protocolContractProblems } from './protocol.contract';

const current = {
    version: PROTOCOL_VERSION,
    minCompatible: MIN_COMPATIBLE_PROTOCOL_VERSION,
    commands: Object.values(CommandType),
    events: Object.values(HostEventType),
    inputEvents: Object.values(InputEventType),
};

describe('Host ⇔ Worker のプロトコルの契約', () => {
    it('今の定義は、契約の最新の版と一致する（変えたら PROTOCOL_VERSION を上げて契約に版を足す）', () => {
        expect(protocolContractProblems(current, PROTOCOL_CONTRACTS)).toEqual([]);
    });
});

describe('protocolContractProblems', () => {
    const v5 = PROTOCOL_CONTRACTS[0];
    if (!v5) throw new Error('契約がありません');

    it('コマンドを足したのに版を上げていなければ問題', () => {
        const problems = protocolContractProblems({ ...current, commands: [...current.commands, 'NEW_CMD'] }, [v5]);
        expect(problems).toEqual([expect.stringContaining('足した: NEW_CMD')]);
    });

    it('版を上げたのに契約に足していなければ問題', () => {
        expect(protocolContractProblems({ ...current, version: 6 }, [v5])).toEqual([
            expect.stringContaining('契約の一覧に新しい版を足して'),
        ]);
    });

    it('版を上げて足せば良い', () => {
        const v6 = { ...v5, version: 6, commands: [...v5.commands, 'NEW_CMD'] };
        expect(protocolContractProblems({ ...current, version: 6, commands: v6.commands }, [v5, v6])).toEqual([]);
    });

    it('消したら、互換の最小の版を上げていなければ問題（破壊的変更を黙って出さない）', () => {
        const v6 = { ...v5, version: 6, commands: v5.commands.filter((c) => c !== 'CMD_GRIP') };
        const next = { ...current, version: 6, commands: v6.commands };
        expect(protocolContractProblems(next, [v5, v6])).toEqual([expect.stringContaining('CMD_GRIP を消しています')]);
        expect(protocolContractProblems({ ...next, minCompatible: 6 }, [v5, v6])).toEqual([]);
    });

    it('契約の版は増えていく', () => {
        expect(protocolContractProblems(current, [v5, { ...v5 }])).toEqual([
            expect.stringContaining('版が増えていません'),
        ]);
    });
});
