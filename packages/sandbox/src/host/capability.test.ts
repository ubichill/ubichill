import { describe, expect, it } from 'vitest';
import {
    ALWAYS_ALLOWED_COMMANDS,
    buildAllowedCommands,
    CAPABILITY_COMMANDS,
    CAPABILITY_RISK,
    getCapabilityRisk,
} from './capability';

describe('getCapabilityRisk', () => {
    it('カタログ通りの危険度を返す', () => {
        expect(getCapabilityRisk('scene:read')).toBe('safe');
        expect(getCapabilityRisk('scene:update')).toBe('sensitive');
        expect(getCapabilityRisk('net:fetch')).toBe('dangerous');
    });

    it('未知の capability は dangerous 扱い（フェイルセーフ）', () => {
        expect(getCapabilityRisk('unknown:power')).toBe('dangerous');
        expect(getCapabilityRisk('')).toBe('dangerous');
    });

    it('カタログの全 capability に危険度が定義されている', () => {
        for (const cap of Object.keys(CAPABILITY_COMMANDS)) {
            expect(CAPABILITY_RISK[cap], `${cap} に危険度が未定義`).toBeDefined();
        }
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
