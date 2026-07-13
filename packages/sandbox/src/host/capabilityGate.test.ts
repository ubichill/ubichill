import { describe, expect, it, vi } from 'vitest';
import { buildAllowedCommands } from './capability';
import { createCapabilityGate } from './capabilityGate';

describe('createCapabilityGate — allowAll モード', () => {
    it('全コマンドを許可する', () => {
        const gate = createCapabilityGate({ allowAll: true });
        expect(gate.authorize('NET_FETCH')).toBe(true);
        expect(gate.authorize('SCENE_UPDATE_ENTITY')).toBe(true);
        expect(gate.authorize('CMD_LOG')).toBe(true);
    });
});

describe('createCapabilityGate — 静的モード（allowlist）', () => {
    it('宣言 capability のコマンドを許可し、それ以外を拒否する', () => {
        const gate = createCapabilityGate({ allowedCommands: buildAllowedCommands(['scene:read']) });
        expect(gate.authorize('SCENE_GET_ENTITY')).toBe(true);
        expect(gate.authorize('NET_FETCH')).toBe(false);
    });

    it('コアコマンドは allowlist が空でも許可する', () => {
        const gate = createCapabilityGate({ allowedCommands: buildAllowedCommands([]) });
        expect(gate.authorize('CMD_LOG')).toBe(true);
        expect(gate.authorize('CMD_GRIP')).toBe(true);
    });

    it('allowlist 未指定なら（コア以外は）全拒否 default-deny', () => {
        const gate = createCapabilityGate({});
        expect(gate.authorize('NET_FETCH')).toBe(false);
        expect(gate.authorize('CMD_LOG')).toBe(true); // コアのみ通る
    });
});

describe('createCapabilityGate — on-demand モード', () => {
    it('コアコマンドは authorizeCapability を呼ばず即許可する', () => {
        const authorize = vi.fn(() => true);
        const gate = createCapabilityGate({ authorizeCapability: authorize });
        expect(gate.authorize('CMD_LOG')).toBe(true);
        expect(authorize).not.toHaveBeenCalled();
    });

    it('どの capability にも属さない未知コマンドは問い合わせず拒否する', () => {
        const authorize = vi.fn(() => true);
        const gate = createCapabilityGate({ authorizeCapability: authorize });
        expect(gate.authorize('TOTALLY_UNKNOWN')).toBe(false);
        expect(authorize).not.toHaveBeenCalled();
    });

    it('コマンドの属する capability をコールバックに問い合わせ、結果をそのまま返す', () => {
        const authorize = vi.fn((cap: string) => cap === 'net:fetch');
        const gate = createCapabilityGate({ authorizeCapability: authorize });
        expect(gate.authorize('NET_FETCH')).toBe(true);
        expect(authorize).toHaveBeenCalledWith('net:fetch');
    });

    it('拒否された capability のコマンドは false になる', () => {
        const gate = createCapabilityGate({ authorizeCapability: () => false });
        expect(gate.authorize('NET_FETCH')).toBe(false);
    });

    it('キャッシュせず毎回評価する（承認が deny→allow に変われば次は許可される）', () => {
        let granted = false;
        const gate = createCapabilityGate({ authorizeCapability: () => granted });
        expect(gate.authorize('SCENE_UPDATE_ENTITY')).toBe(false); // 承認前
        granted = true; // 読み込み時の一括承認で許可された想定
        expect(gate.authorize('SCENE_UPDATE_ENTITY')).toBe(true); // キャッシュされていないので反映
    });

    it('コールバックが throw したら安全側（拒否）に倒す', () => {
        const gate = createCapabilityGate({
            authorizeCapability: () => {
                throw new Error('boom');
            },
        });
        expect(gate.authorize('NET_FETCH')).toBe(false);
    });
});
