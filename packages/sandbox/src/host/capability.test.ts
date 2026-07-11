import { describe, expect, it } from 'vitest';
import {
    ALWAYS_ALLOWED_COMMANDS,
    buildAllowedCommands,
    CAPABILITY_CATALOG,
    CAPABILITY_COMMANDS,
    CAPABILITY_RISK,
    describeCapability,
    getCapabilityRisk,
    listCapabilities,
} from './capability';

describe('getCapabilityRisk', () => {
    it('カタログ通りの危険度を返す', () => {
        expect(getCapabilityRisk('scene:read')).toBe('safe');
        expect(getCapabilityRisk('scene:update')).toBe('sensitive');
        expect(getCapabilityRisk('net:fetch')).toBe('dangerous');
    });

    it('net:host-message は内部通知なので sensitive（外部通信の dangerous ではない）', () => {
        // 既定シールドで確認プロンプトを出さないための分類。net:fetch のみ dangerous。
        expect(getCapabilityRisk('net:host-message')).toBe('sensitive');
    });

    it('未知の capability は dangerous 扱い（フェイルセーフ）', () => {
        expect(getCapabilityRisk('unknown:power')).toBe('dangerous');
        expect(getCapabilityRisk('')).toBe('dangerous');
    });
});

describe('CAPABILITY_CATALOG（単一の真実の源）', () => {
    it('全エントリが risk/commands/label/description を揃えている', () => {
        for (const [cap, spec] of Object.entries(CAPABILITY_CATALOG)) {
            expect(['safe', 'sensitive', 'dangerous'], `${cap} の risk が不正`).toContain(spec.risk);
            expect(spec.commands.length, `${cap} に commands が無い`).toBeGreaterThan(0);
            expect(spec.label.length, `${cap} に label が無い`).toBeGreaterThan(0);
            expect(spec.description.length, `${cap} に description が無い`).toBeGreaterThan(0);
        }
    });

    it('派生ビュー CAPABILITY_COMMANDS / CAPABILITY_RISK がカタログと一致する', () => {
        for (const [cap, spec] of Object.entries(CAPABILITY_CATALOG)) {
            expect(CAPABILITY_COMMANDS[cap]).toEqual(spec.commands);
            expect(CAPABILITY_RISK[cap]).toBe(spec.risk);
        }
        expect(Object.keys(CAPABILITY_COMMANDS).sort()).toEqual(Object.keys(CAPABILITY_CATALOG).sort());
    });
});

describe('describeCapability / listCapabilities（見える化）', () => {
    it('既知の capability を known=true で説明する', () => {
        const info = describeCapability('net:fetch');
        expect(info).toMatchObject({ capability: 'net:fetch', risk: 'dangerous', known: true });
        expect(info.label).not.toBe('');
        expect(info.description).not.toBe('');
    });

    it('未知の capability も known=false・dangerous で必ず説明を返す', () => {
        const info = describeCapability('mystery:power');
        expect(info).toMatchObject({ capability: 'mystery:power', risk: 'dangerous', known: false });
        expect(info.description.length).toBeGreaterThan(0);
    });

    it('listCapabilities はカタログ全件を返す', () => {
        const all = listCapabilities();
        expect(all).toHaveLength(Object.keys(CAPABILITY_CATALOG).length);
        expect(all.every((c) => c.known)).toBe(true);
    });
});

describe('buildAllowedCommands', () => {
    it('capabilities 未指定でもコアコマンドのみ許可する（default-deny）', () => {
        const allowed = buildAllowedCommands(undefined);
        expect([...allowed].sort()).toEqual([...ALWAYS_ALLOWED_COMMANDS].sort());
        // 宣言していない外部通信コマンドは決して含まれない
        expect(allowed.has('NET_FETCH')).toBe(false);
    });

    it('空配列でもコアコマンドのみ許可する', () => {
        const allowed = buildAllowedCommands([]);
        expect([...allowed].sort()).toEqual([...ALWAYS_ALLOWED_COMMANDS].sort());
    });

    it('宣言 capability に対応するコマンドを追加する', () => {
        const allowed = buildAllowedCommands(['net:fetch']);
        expect(allowed.has('NET_FETCH')).toBe(true);
        // コアコマンドは常に含まれる
        expect(allowed.has('CMD_LOG')).toBe(true);
    });

    it('未知の capability はコマンドを増やさない（無視される）', () => {
        const base = buildAllowedCommands([]);
        const withUnknown = buildAllowedCommands(['bogus:cap']);
        expect([...withUnknown].sort()).toEqual([...base].sort());
    });

    it('複数 capability の和集合を作る', () => {
        const allowed = buildAllowedCommands(['scene:read', 'scene:update']);
        expect(allowed.has('SCENE_GET_ENTITY')).toBe(true);
        expect(allowed.has('SCENE_CREATE_ENTITY')).toBe(true);
    });
});
