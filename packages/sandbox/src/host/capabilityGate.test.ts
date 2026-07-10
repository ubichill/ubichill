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

    it('コマンドの属する capability をコールバックに問い合わせる', async () => {
        const authorize = vi.fn((cap: string) => cap === 'net:fetch');
        const gate = createCapabilityGate({ authorizeCapability: authorize });
        await expect(gate.authorize('NET_FETCH')).resolves.toBe(true);
        expect(authorize).toHaveBeenCalledWith('net:fetch');
    });

    it('拒否された capability のコマンドは false になる', async () => {
        const gate = createCapabilityGate({ authorizeCapability: () => false });
        await expect(gate.authorize('NET_FETCH')).resolves.toBe(false);
    });

    it('同じ capability は一度だけ問い合わせ、結果をキャッシュする（二重プロンプト防止）', async () => {
        const authorize = vi.fn(() => true);
        const gate = createCapabilityGate({ authorizeCapability: authorize });
        // 同 capability に属する 2 コマンド（video:control）を連続で
        await Promise.all([gate.authorize('MEDIA_PLAY'), gate.authorize('MEDIA_PAUSE')]);
        await gate.authorize('MEDIA_SEEK');
        expect(authorize).toHaveBeenCalledTimes(1);
    });

    it('承認待ち中に来た同 capability の複数コマンドは 1 本のプロンプトに集約される', async () => {
        let resolveConsent: (v: boolean) => void = () => {};
        const authorize = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveConsent = resolve;
                }),
        );
        const gate = createCapabilityGate({ authorizeCapability: authorize });
        const p1 = gate.authorize('MEDIA_PLAY');
        const p2 = gate.authorize('MEDIA_PAUSE');
        // authorize はマイクロタスク遅延で呼ばれるため一度フラッシュしてから検証する
        await new Promise((r) => setTimeout(r, 0));
        expect(authorize).toHaveBeenCalledTimes(1); // 2 コマンド来ても問い合わせは 1 回だけ
        resolveConsent(true);
        await expect(Promise.all([p1, p2])).resolves.toEqual([true, true]);
        expect(authorize).toHaveBeenCalledTimes(1);
    });

    it('コールバックが throw したら安全側（拒否）に倒す', async () => {
        const gate = createCapabilityGate({
            authorizeCapability: () => {
                throw new Error('boom');
            },
        });
        await expect(gate.authorize('NET_FETCH')).resolves.toBe(false);
    });
});
