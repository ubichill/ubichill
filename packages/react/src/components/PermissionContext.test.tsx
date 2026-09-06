// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { PermissionPolicy } from '@ubichill/shared';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionProvider, useUbiPermissions } from './PermissionContext';

function setup(onPolicyChange?: (p: PermissionPolicy) => void) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <PermissionProvider onPolicyChange={onPolicyChange}>{children}</PermissionProvider>
    );
    const { result } = renderHook(() => useUbiPermissions(), { wrapper });
    if (!result.current) throw new Error('permissions context is null');
    return result as { current: NonNullable<typeof result.current> };
}

describe('authorizeCapability（実行時ゲート・プロンプトを出さない）', () => {
    it('safe / sensitive は既定で許可、net:fetch は常に許可', () => {
        const ctx = setup();
        expect(ctx.current.authorizeCapability('p', 'scene:read')).toBe(true); // safe
        expect(ctx.current.authorizeCapability('p', 'scene:update')).toBe(true); // sensitive(既定allow)
        expect(ctx.current.authorizeCapability('p', 'net:fetch')).toBe(true); // ドメイン側で判定
        expect(ctx.current.pendingPrompt).toBeNull(); // 一切プロンプトを出さない
    });

    it('ask 未決の危険 capability は false（承認は authorizeMod で確定）', () => {
        const ctx = setup();
        expect(ctx.current.authorizeCapability('p', 'mystery:power')).toBe(false); // 未知→dangerous→ask未決
    });
});

describe('authorizeMod（読み込み時の一括承認）', () => {
    it('承認が要らなければプロンプトを出さず即解決する', async () => {
        const ctx = setup();
        await act(async () => {
            await ctx.current.authorizeMod('p', ['scene:read', 'scene:update', 'event:emit']);
        });
        expect(ctx.current.pendingPrompt).toBeNull();
    });

    it('承認が要る capability をまとめて 1 プロンプトに提示し、許可で全て grant する', async () => {
        const ctx = setup();
        let done: Promise<void> = Promise.resolve();
        act(() => {
            done = ctx.current.authorizeMod('p', ['scene:read', 'mystery:power', 'other:danger']);
        });
        // safe(scene:read) は除外、危険2つが1プロンプトに束ねられる
        expect(ctx.current.pendingPrompt).toEqual({
            kind: 'mod',
            modId: 'p',
            capabilities: [
                { capability: 'mystery:power', risk: 'dangerous' },
                { capability: 'other:danger', risk: 'dangerous' },
            ],
        });
        act(() => ctx.current.resolvePrompt('allow'));
        await act(async () => {
            await done;
        });
        expect(ctx.current.authorizeCapability('p', 'mystery:power')).toBe(true);
        expect(ctx.current.authorizeCapability('p', 'other:danger')).toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
    });

    it('拒否すると全て deny として記憶される', async () => {
        const ctx = setup();
        let done: Promise<void> = Promise.resolve();
        act(() => {
            done = ctx.current.authorizeMod('p', ['mystery:power']);
        });
        act(() => ctx.current.resolvePrompt('deny'));
        await act(async () => {
            await done;
        });
        expect(ctx.current.authorizeCapability('p', 'mystery:power')).toBe(false);
    });

    it('sensitive を strict(ask) にすると sensitive も一括承認の対象になる', () => {
        const ctx = setup();
        act(() => ctx.current.setTierDefaults({ safe: 'allow', sensitive: 'ask', dangerous: 'ask' }));
        act(() => {
            void ctx.current.authorizeMod('p', ['scene:update']);
        });
        expect(ctx.current.pendingPrompt).toMatchObject({ kind: 'mod', modId: 'p' });
    });
});

describe('authorizeExternalDomain（fetch・メディア共通のドメイン許可）', () => {
    it('同じmod・ドメインの同時要求は1つの確認にまとめる', async () => {
        const ctx = setup();
        let fetchRequest: boolean | Promise<boolean> = false;
        let mediaRequest: boolean | Promise<boolean> = false;
        act(() => {
            fetchRequest = ctx.current.authorizeExternalDomain('vp', 'media.example.com');
            mediaRequest = ctx.current.authorizeExternalDomain('vp', 'media.example.com');
        });

        expect(fetchRequest).toBe(mediaRequest);
        expect(ctx.current.pendingPrompt).toEqual({ kind: 'external', modId: 'vp', domain: 'media.example.com' });
        act(() => ctx.current.resolvePrompt('once'));
        await expect(fetchRequest).resolves.toBe(true);
        await expect(mediaRequest).resolves.toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
    });

    it('既定はドメインごとにプロンプト。「次回以降も許可」で記憶される', async () => {
        const ctx = setup();
        let p: boolean | Promise<boolean> = false;
        act(() => {
            p = ctx.current.authorizeExternalDomain('vp', 'api.example.com');
        });
        expect(ctx.current.pendingPrompt).toEqual({ kind: 'external', modId: 'vp', domain: 'api.example.com' });
        act(() => ctx.current.resolvePrompt('always'));
        await expect(p).resolves.toBe(true);
        // 記憶され、次回は同期 true
        expect(ctx.current.authorizeExternalDomain('vp', 'api.example.com')).toBe(true);
    });

    it('「今回だけ」は true を返すが記憶しない（次回また聞く）', async () => {
        const ctx = setup();
        let p: boolean | Promise<boolean> = false;
        act(() => {
            p = ctx.current.authorizeExternalDomain('vp', 'api.example.com');
        });
        act(() => ctx.current.resolvePrompt('once'));
        await expect(p).resolves.toBe(true);
        // 記憶されていないので再度プロンプト
        act(() => {
            void ctx.current.authorizeExternalDomain('vp', 'api.example.com');
        });
        expect(ctx.current.pendingPrompt).toEqual({ kind: 'external', modId: 'vp', domain: 'api.example.com' });
    });

    it('「拒否」は false を返し記憶される', async () => {
        const ctx = setup();
        let p: boolean | Promise<boolean> = true;
        act(() => {
            p = ctx.current.authorizeExternalDomain('vp', 'evil.example.com');
        });
        act(() => ctx.current.resolvePrompt('deny'));
        await expect(p).resolves.toBe(false);
        expect(ctx.current.authorizeExternalDomain('vp', 'evil.example.com')).toBe(false);
    });

    it('シールド「なし」は全ドメイン即許可、「拒否」は全ドメイン即拒否', () => {
        const ctx = setup();
        act(() => ctx.current.setTierDefaults({ safe: 'allow', sensitive: 'allow', dangerous: 'allow' }));
        expect(ctx.current.authorizeExternalDomain('vp', 'api.example.com')).toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
        act(() => ctx.current.setTierDefaults({ safe: 'allow', sensitive: 'deny', dangerous: 'deny' }));
        expect(ctx.current.authorizeExternalDomain('vp', 'api.example.com')).toBe(false);
    });
});

describe('grantCapability / grantExternalDomain（拒否トーストの「許可」ボタン用）', () => {
    it('拒否済み capability を許可に上書きできる', async () => {
        const ctx = setup();
        // まず拒否
        let done: Promise<void> = Promise.resolve();
        act(() => {
            done = ctx.current.authorizeMod('p', ['mystery:power']);
        });
        act(() => ctx.current.resolvePrompt('deny'));
        await act(async () => {
            await done;
        });
        expect(ctx.current.authorizeCapability('p', 'mystery:power')).toBe(false);
        // 「許可」で上書き
        act(() => ctx.current.grantCapability('p', 'mystery:power'));
        expect(ctx.current.authorizeCapability('p', 'mystery:power')).toBe(true);
    });

    it('拒否済み外部通信ドメインを許可に上書きできる', async () => {
        const ctx = setup();
        let p: boolean | Promise<boolean> = true;
        act(() => {
            p = ctx.current.authorizeExternalDomain('vp', 'api.example.com');
        });
        act(() => ctx.current.resolvePrompt('deny'));
        await expect(p).resolves.toBe(false);
        act(() => ctx.current.grantExternalDomain('vp', 'api.example.com'));
        expect(ctx.current.authorizeExternalDomain('vp', 'api.example.com')).toBe(true);
    });
});

describe('取り消し', () => {
    it('revokeGrant / revokeExternalGrant で記憶を消せる', async () => {
        const onChange = vi.fn();
        const ctx = setup(onChange);
        // capability を許可 → 取り消し
        act(() => {
            void ctx.current.authorizeMod('p', ['mystery:power']);
        });
        act(() => ctx.current.resolvePrompt('allow'));
        expect(ctx.current.authorizeCapability('p', 'mystery:power')).toBe(true);
        act(() => ctx.current.revokeGrant('p', 'mystery:power'));
        expect(ctx.current.authorizeCapability('p', 'mystery:power')).toBe(false);
        // 外部通信ドメインを許可 → 取り消し
        let fp: boolean | Promise<boolean> = false;
        act(() => {
            fp = ctx.current.authorizeExternalDomain('p', 'api.example.com');
        });
        act(() => ctx.current.resolvePrompt('always'));
        await fp;
        expect(ctx.current.authorizeExternalDomain('p', 'api.example.com')).toBe(true);
        act(() => ctx.current.revokeExternalGrant('p', 'api.example.com'));
        act(() => {
            void ctx.current.authorizeExternalDomain('p', 'api.example.com');
        });
        expect(ctx.current.pendingPrompt).toMatchObject({ kind: 'external', domain: 'api.example.com' });
        expect(onChange).toHaveBeenCalled();
    });
});
