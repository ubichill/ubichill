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
    // 版を上げても書き換えずに済むよう、今の最新の契約とその次の版を基準にする
    const latest = PROTOCOL_CONTRACTS.at(-1);
    if (!latest) throw new Error('契約がありません');
    const nextVersion = latest.version + 1;

    it('コマンドを足したのに版を上げていなければ問題', () => {
        const problems = protocolContractProblems({ ...current, commands: [...current.commands, 'NEW_CMD'] }, [latest]);
        expect(problems).toEqual([expect.stringContaining('足した: NEW_CMD')]);
    });

    it('版を上げたのに契約に足していなければ問題', () => {
        expect(protocolContractProblems({ ...current, version: nextVersion }, [latest])).toEqual([
            expect.stringContaining('契約の一覧に新しい版を足して'),
        ]);
    });

    it('版を上げて足せば良い', () => {
        const next = { ...latest, version: nextVersion, commands: [...latest.commands, 'NEW_CMD'] };
        expect(
            protocolContractProblems({ ...current, version: nextVersion, commands: next.commands }, [latest, next]),
        ).toEqual([]);
    });

    it('消したら、互換の最小の版を上げていなければ問題（破壊的変更を黙って出さない）', () => {
        const next = { ...latest, version: nextVersion, commands: latest.commands.filter((c) => c !== 'CMD_GRIP') };
        const changed = { ...current, version: nextVersion, commands: next.commands };
        expect(protocolContractProblems(changed, [latest, next])).toEqual([
            expect.stringContaining('CMD_GRIP を消しています'),
        ]);
        expect(protocolContractProblems({ ...changed, minCompatible: nextVersion }, [latest, next])).toEqual([]);
    });

    it('契約の版は増えていく', () => {
        expect(protocolContractProblems(current, [latest, { ...latest }])).toEqual([
            expect.stringContaining('版が増えていません'),
        ]);
    });

    it('同じ一覧のまま版だけ上げる（ペイロードに任意の項目を足した）のは問題ない', () => {
        const next = { ...latest, version: nextVersion };
        expect(protocolContractProblems({ ...current, version: nextVersion }, [latest, next])).toEqual([]);
    });
});
