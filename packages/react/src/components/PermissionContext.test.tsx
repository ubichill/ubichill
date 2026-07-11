// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { PermissionPolicy } from '@ubichill/sandbox';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionProvider, useUbiPermissions } from './PermissionContext';

function setup(onPolicyChange?: (p: PermissionPolicy) => void) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <PermissionProvider onPolicyChange={onPolicyChange}>{children}</PermissionProvider>
    );
    const { result } = renderHook(() => useUbiPermissions(), { wrapper });
    // Provider 配下なので null にはならない
    if (!result.current) throw new Error('permissions context is null');
    return result as { current: NonNullable<typeof result.current> };
}

describe('PermissionProvider.authorizeCapability', () => {
    it('safe / sensitive は既定で同期的に許可し、プロンプトを出さない', () => {
        const ctx = setup();
        expect(ctx.current.authorizeCapability('plugin-a', 'scene:read')).toBe(true); // safe
        expect(ctx.current.authorizeCapability('plugin-a', 'scene:update')).toBe(true); // sensitive
        expect(ctx.current.pendingPrompt).toBeNull();
    });

    it('dangerous は承認プロンプトを出し、許可するまで解決しない', async () => {
        const onChange = vi.fn();
        const ctx = setup(onChange);

        let promise: boolean | Promise<boolean> = false;
        act(() => {
            promise = ctx.current.authorizeCapability('plugin-a', 'net:fetch');
        });

        // プロンプトが立ち、まだ解決していない（= プラグインは動けない）
        expect(ctx.current.pendingPrompt).toEqual({ pluginId: 'plugin-a', capability: 'net:fetch' });

        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await expect(promise).resolves.toBe(true);
        expect(ctx.current.pendingPrompt).toBeNull();
        expect(onChange).toHaveBeenCalled();

        // 記憶され、次回は同期許可（再プロンプトなし）
        expect(ctx.current.authorizeCapability('plugin-a', 'net:fetch')).toBe(true);
    });

    it('dangerous を拒否すると false になり、記憶される', async () => {
        const ctx = setup();
        let promise: boolean | Promise<boolean> = true;
        act(() => {
            promise = ctx.current.authorizeCapability('plugin-a', 'net:fetch');
        });
        act(() => {
            ctx.current.resolvePrompt('deny');
        });
        await expect(promise).resolves.toBe(false);
        expect(ctx.current.authorizeCapability('plugin-a', 'net:fetch')).toBe(false);
    });

    it('承認待ち中に来た同 (plugin, capability) の複数要求は 1 本のプロンプトに集約される', async () => {
        const ctx = setup();
        let p1: boolean | Promise<boolean> = false;
        let p2: boolean | Promise<boolean> = false;
        act(() => {
            p1 = ctx.current.authorizeCapability('plugin-a', 'net:fetch');
            p2 = ctx.current.authorizeCapability('plugin-a', 'net:fetch');
        });
        // プロンプトは 1 件だけ
        expect(ctx.current.pendingPrompt).toEqual({ pluginId: 'plugin-a', capability: 'net:fetch' });
        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await expect(Promise.all([p1, p2])).resolves.toEqual([true, true]);
    });

    it('ティア既定を ask にすると sensitive も承認待ちになる', () => {
        const ctx = setup();
        act(() => {
            ctx.current.setTierDefaults({ safe: 'allow', sensitive: 'ask', dangerous: 'ask' });
        });
        act(() => {
            void ctx.current.authorizeCapability('plugin-a', 'scene:update');
        });
        expect(ctx.current.pendingPrompt).toEqual({ pluginId: 'plugin-a', capability: 'scene:update' });
    });

    it('revokeGrant で記憶した判断を取り消せる', async () => {
        const ctx = setup();
        let promise: boolean | Promise<boolean> = false;
        act(() => {
            promise = ctx.current.authorizeCapability('plugin-a', 'net:fetch');
        });
        act(() => {
            ctx.current.resolvePrompt('allow');
        });
        await promise;
        expect(ctx.current.authorizeCapability('plugin-a', 'net:fetch')).toBe(true);

        act(() => {
            ctx.current.revokeGrant('plugin-a', 'net:fetch');
        });
        // 取り消し後は再び ask（プロンプト）に戻る
        act(() => {
            void ctx.current.authorizeCapability('plugin-a', 'net:fetch');
        });
        expect(ctx.current.pendingPrompt).toEqual({ pluginId: 'plugin-a', capability: 'net:fetch' });
    });
});
